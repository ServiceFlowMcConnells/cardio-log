// Readiness scan: a rules-based autoregulation model.
//
// Inputs (each 1–5, 5 is best): sleep quality, energy, soreness (5 = not sore).
// Plus hours slept and morning bodyweight.
//
// Score (0–100):
//   1. Wellness: weighted mean of the three ratings (energy counts 1.25×), mapped so all 3s ("normal") = 70,
//      all 4s = 85, all 5s = 100, all 2s = 40, all 1s = 10.
//      Short wellness questionnaires like this (Hooper, McLean) track training readiness well.
//   2. Sleep hours: under 5 h −15, under 6 h −10, under 7 h −4.
//   3. Personal baseline: once there are 5+ scans in the last 28 days, today's wellness is compared
//      with your own average; 30% of the gap counts (capped −10 / +5). Being below *your* normal
//      matters more than the raw number.
//   4. Bodyweight (in a deficit): losing more than 1% of bodyweight a week −5; a drop of over 1.5%
//      since the previous weigh-in (usually water/glycogen) −3.
//
// Bands set the workout plan (RPE-based autoregulation):
//   90+  Primed      plan as written; take any weight increase you've earned (no extra load on top)
//   70+  Ready       as planned
//   55+  Moderate    loads −5%, don't go past target RPE, no load progression today
//   40+  Low         loads −10%, one fewer set per exercise, target RPE −1
//   <40  Very low    loads −15%, one fewer set, RPE 7 max; consider a light session or rest
// Soreness of 1–2 also removes a set per exercise (volume, not intensity, is what sore muscles need cut).

export interface Checkin {
  id: string;
  checked_at: string;
  sleep_quality: number;
  energy: number;
  soreness: number;
  sleep_hours: number | null;
  bodyweight_kg: number | null;
  score: number;
  notes: string | null;
}

export type Band = "primed" | "ready" | "moderate" | "low" | "very_low";

export interface Adjustment {
  band: Band;
  score: number;
  loadFactor: number; // multiply suggested working weights
  rpeOffset: number; // add to target RPE (negative = easier)
  rpeCap: number | null; // never suggest above this
  setDelta: number; // change to planned working sets
  allowProgression: boolean;
  headline: string;
  reasons: string[];
}

export const BAND_LABEL: Record<Band, string> = {
  primed: "Primed",
  ready: "Ready",
  moderate: "Moderate",
  low: "Low",
  very_low: "Very low",
};

export const SLEEP_LABELS = ["Terrible", "Poor", "OK", "Good", "Great"];
export const ENERGY_LABELS = ["Exhausted", "Tired", "Normal", "Fresh", "Full of beans"];
export const SORENESS_LABELS = ["Very sore", "Sore", "Bit stiff", "Barely", "None"];

const DAY = 86400000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// A "3" is a normal day, so it maps to 70 (ready), not to the midpoint.
const WELLNESS_CURVE = [10, 40, 70, 85, 100];

export function wellness(sleepQ: number, energy: number, soreness: number): number {
  const m = (sleepQ + 1.25 * energy + soreness) / 3.25;
  const lo = Math.max(1, Math.min(4, Math.floor(m)));
  return WELLNESS_CURVE[lo - 1] + (WELLNESS_CURVE[lo] - WELLNESS_CURVE[lo - 1]) * (m - lo);
}

export interface ScoreInput {
  sleep_quality: number;
  energy: number;
  soreness: number;
  sleep_hours: number | null;
  bodyweight_kg: number | null;
  at: string; // ISO time of this scan
}

export interface ScoreResult {
  score: number;
  parts: { label: string; value: number }[];
  notes: string[];
}

/** `history` = earlier check-ins (any order); the scan being scored must not be in it. */
export function scoreReadiness(input: ScoreInput, history: Checkin[]): ScoreResult {
  const t = new Date(input.at).getTime();
  const earlier = history.filter((c) => new Date(c.checked_at).getTime() < t).sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const parts: { label: string; value: number }[] = [];
  const notes: string[] = [];

  const w = wellness(input.sleep_quality, input.energy, input.soreness);
  parts.push({ label: "Sleep, energy and soreness", value: Math.round(w) });

  let sleepAdj = 0;
  if (input.sleep_hours != null) {
    if (input.sleep_hours < 5) sleepAdj = -15;
    else if (input.sleep_hours < 6) sleepAdj = -10;
    else if (input.sleep_hours < 7) sleepAdj = -4;
    if (sleepAdj) {
      parts.push({ label: `${input.sleep_hours} h sleep`, value: sleepAdj });
      notes.push(input.sleep_hours < 6 ? "Short sleep reduces strength and how hard sets feel." : "A bit under 7 hours of sleep.");
    }
  }

  const window = earlier.filter((c) => t - new Date(c.checked_at).getTime() <= 28 * DAY);
  if (window.length >= 5) {
    const base = window.reduce((a, c) => a + wellness(c.sleep_quality, c.energy, c.soreness), 0) / window.length;
    const adj = Math.round(clamp((w - base) * 0.3, -10, 5));
    if (adj !== 0) {
      parts.push({ label: adj < 0 ? "Below your usual" : "Above your usual", value: adj });
      if (adj <= -4) notes.push("You're feeling worse than your normal for the last 4 weeks.");
    }
  }

  if (input.bodyweight_kg != null) {
    const rate = weeklyLossPct([...earlier, { checked_at: input.at, bodyweight_kg: input.bodyweight_kg }]);
    if (rate != null && rate > 1) {
      parts.push({ label: `Losing ${rate.toFixed(1)}% bodyweight a week`, value: -5 });
      notes.push("Weight is dropping faster than 1% a week, which tends to cost strength and recovery. Worth raising with your coach.");
    }
    const prev = earlier.find((c) => c.bodyweight_kg != null && t - new Date(c.checked_at).getTime() <= 4 * DAY);
    if (prev?.bodyweight_kg && (prev.bodyweight_kg - input.bodyweight_kg) / prev.bodyweight_kg > 0.015) {
      parts.push({ label: "Sharp drop since last weigh-in", value: -3 });
      notes.push("A sudden overnight drop is usually water and glycogen; eat and drink well before training.");
    }
  }

  const score = Math.round(clamp(parts.reduce((a, p) => a + p.value, 0), 0, 100));
  return { score, parts, notes };
}

export function bandFor(score: number): Band {
  if (score >= 90) return "primed";
  if (score >= 70) return "ready";
  if (score >= 55) return "moderate";
  if (score >= 40) return "low";
  return "very_low";
}

export function adjustmentFor(c: Pick<Checkin, "score" | "soreness">): Adjustment {
  const band = bandFor(c.score);
  const base: Record<Band, Omit<Adjustment, "band" | "score" | "reasons">> = {
    primed: { loadFactor: 1, rpeOffset: 0, rpeCap: null, setDelta: 0, allowProgression: true, headline: "Good day: take any weight increase you've earned" },
    ready: { loadFactor: 1, rpeOffset: 0, rpeCap: null, setDelta: 0, allowProgression: true, headline: "Train as planned" },
    moderate: { loadFactor: 0.95, rpeOffset: 0, rpeCap: null, setDelta: 0, allowProgression: false, headline: "Loads −5%, stop at your target RPE" },
    low: { loadFactor: 0.9, rpeOffset: -1, rpeCap: null, setDelta: -1, allowProgression: false, headline: "Loads −10%, one fewer set, RPE −1" },
    very_low: { loadFactor: 0.85, rpeOffset: -2, rpeCap: 7, setDelta: -1, allowProgression: false, headline: "Light day: loads −15%, RPE 7 max" },
  };
  const a: Adjustment = { band, score: c.score, ...base[band], reasons: [] };
  if (c.soreness <= 2 && a.setDelta === 0) {
    a.setDelta = -1;
    a.headline += ", one fewer set for soreness";
    a.reasons.push("Soreness is high, so volume comes down a set while load stays.");
  }
  if (band === "very_low") a.reasons.push("Consider swapping for an easy cardio session, technique work or rest. One easy day costs nothing.");
  return a;
}

/** Target RPE after readiness, or null if the plan has none. */
export function adjustedRpe(target: number | null, a: Adjustment | null): number | null {
  if (target == null) return a?.rpeCap ?? null;
  if (!a) return target;
  let r = target + a.rpeOffset;
  if (a.rpeCap != null) r = Math.min(r, a.rpeCap);
  return clamp(Math.round(r * 2) / 2, 5, 10);
}

export function adjustedSets(planned: number, a: Adjustment | null): number {
  if (!a || a.setDelta === 0) return planned;
  return Math.max(Math.min(planned, 2), planned + a.setDelta);
}

/** Weekly bodyweight change as % lost (positive = losing): last 7 days' average vs the 7 days before. */
export function weeklyLossPct(points: { checked_at: string; bodyweight_kg: number | null }[], now = Date.now()): number | null {
  const pts = points.filter((p) => p.bodyweight_kg != null).map((p) => ({ t: new Date(p.checked_at).getTime(), w: p.bodyweight_kg as number }));
  const last = Math.max(...pts.map((p) => p.t), 0);
  const ref = Math.min(now, last || now);
  const a = pts.filter((p) => ref - p.t < 7 * DAY && p.t <= ref);
  const b = pts.filter((p) => ref - p.t >= 7 * DAY && ref - p.t < 14 * DAY);
  if (a.length < 2 || b.length < 2) return null;
  const avg = (x: typeof pts) => x.reduce((s, p) => s + p.w, 0) / x.length;
  const before = avg(b);
  return ((before - avg(a)) / before) * 100;
}

const sameLocalDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function todaysCheckin(checkins: Checkin[]): Checkin | null {
  const now = new Date();
  return checkins.find((c) => sameLocalDay(new Date(c.checked_at), now)) ?? null;
}
