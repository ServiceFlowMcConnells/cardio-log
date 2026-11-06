// Strength report: recent performance against the period before, in one standard format.
// Each lift's trend is a least-squares line through its per-session e1RM (so one good or bad day can't swing it),
// expressed as % per week; its "now" is the best e1RM in the period. Thresholds loosen in a deficit, where
// holding strength is the goal.
import type { E1rmFormula, Exercise, Template, Workout, WSet } from "./strength";
import { bestE1rm, isConditioning, isWorking, sessionE1rm } from "./strength";
import type { Checkin, Phase } from "./readiness";
import { latestPhase } from "./readiness";
import type { NutritionData } from "./nutrition";
import { dayTotals, targetFor, ymd } from "./nutrition";
import type { DayActivity } from "./health";

const DAY = 86400000;

export type LiftStatus = "up" | "hold" | "stalled" | "down" | "few";
export const STATUS_LABEL: Record<LiftStatus, string> = { up: "Progressing", hold: "Holding", stalled: "Stalled", down: "Slipping", few: "Not enough data" };

export interface LiftTrend {
  id: string;
  name: string;
  sessions: number; // in the period
  now: number | null; // best e1RM in the period
  before: number | null; // best e1RM in the period before
  change: number | null; // % now vs before
  slope: number | null; // % per week across the period
  points: { t: number; e: number }[]; // both periods, oldest first (for the sparkline)
  status: LiftStatus;
  reason: string;
}

export interface Stat { now: number | null; before: number | null }
export interface Flag { tone: "good" | "watch" | "bad"; text: string }

export interface StrengthReport {
  weeks: number;
  from: number; // period start (ms)
  phase: Phase | null;
  headline: string;
  tone: "good" | "watch" | "bad";
  counts: Record<LiftStatus, number>;
  sessionsPerWeek: Stat;
  setsPerWeek: Stat;
  avgRpe: Stat;
  medianChange: number | null; // % across lifts with a comparison
  lifts: LiftTrend[];
  context: {
    weight: Stat; // average kg
    weightRate: number | null; // % per week across the period
    relative: number | null; // median lift change minus bodyweight change (%)
    readiness: Stat;
    sleep: Stat; // hours
    kcal: { avg: number | null; target: number | null };
    protein: { avg: number | null; target: number | null };
  };
  flags: Flag[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? ((a - b) / b) * 100 : null);
/** Slope of y over days, as % of the mean per week. */
function slopePctPerWeek(pts: { t: number; e: number }[]): number | null {
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.t / DAY), ys = pts.map((p) => p.e);
  const mx = avg(xs)!, my = avg(ys)!;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (den < 1) return null; // all on (nearly) one day
  const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  return ((b * 7) / my) * 100;
}
const fmt1 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

export function strengthReport(input: {
  workouts: Workout[]; exercises: Exercise[]; templates: Template[]; checkins: Checkin[]; nutrition: NutritionData; activity: DayActivity[]; formula: E1rmFormula;
}, weeks = 4, nowMs = Date.now()): StrengthReport {
  const { exercises, templates, checkins, nutrition, activity, formula } = input;
  const span = weeks * 7 * DAY;
  const end = nowMs + 1;
  const from = nowMs - span, prevFrom = nowMs - 2 * span;
  const tpl = new Map(templates.map((t) => [t.id, t]));
  // Strength sessions only (conditioning circuits don't count towards strength)
  const strength = input.workouts.filter((w) => !isConditioning(w.template_id ? tpl.get(w.template_id) : null));
  const inA = (t: number) => t >= from && t < end, inB = (t: number) => t >= prevFrom && t < from;
  const wA = strength.filter((w) => inA(new Date(w.started_at).getTime()));
  const wB = strength.filter((w) => inB(new Date(w.started_at).getTime()));
  const phase = latestPhase(checkins);
  const up = phase === "deficit" ? 0.25 : 0.5;
  const down = phase === "deficit" ? -0.75 : -0.5;

  // ---- lifts ----
  const byEx = new Map<string, { t: number; e: number; best: number | null; sets: WSet[] }[]>();
  for (const w of [...wA, ...wB]) {
    const t = new Date(w.started_at).getTime();
    const groups = new Map<string, WSet[]>();
    for (const s of w.sets) if (isWorking(s) && s.weight_kg > 0 && s.reps > 0) groups.set(s.exercise_id, [...(groups.get(s.exercise_id) ?? []), s]);
    for (const [id, sets] of groups) {
      const e = sessionE1rm(sets, formula);
      if (e == null) continue;
      byEx.set(id, [...(byEx.get(id) ?? []), { t, e, best: bestE1rm(sets, formula), sets }]);
    }
  }
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const lifts: LiftTrend[] = [];
  for (const [id, all] of byEx) {
    const pts = all.sort((a, b) => a.t - b.t);
    const a = pts.filter((p) => inA(p.t));
    if (!a.length) continue; // not trained this period
    const b = pts.filter((p) => inB(p.t));
    const best = (xs: typeof pts) => xs.reduce<number | null>((m, p) => (p.best != null && (m == null || p.best > m) ? p.best : m), null);
    const now = best(a), before = best(b);
    const change = pct(now, before);
    // Trend across both periods when there's enough, so the line has a longer base
    const slope = slopePctPerWeek(pts.length >= 4 ? pts : a);
    let status: LiftStatus;
    let reason: string;
    const rate = slope ?? (change != null ? change / weeks : null);
    if (a.length < 2 && b.length < 2) { status = "few"; reason = `${a.length + b.length} session${a.length + b.length === 1 ? "" : "s"} in 8 weeks`; }
    else if (rate == null) { status = "few"; reason = "Needs a session in the previous period to compare"; }
    else if (rate >= up) { status = "up"; reason = `${fmt1(rate)}% a week${change != null ? `, best ${fmt1(change)}% vs previous ${weeks} weeks` : ""}`; }
    else if (rate <= down) { status = "down"; reason = `${fmt1(rate)}% a week${change != null ? `, best ${fmt1(change)}% vs previous ${weeks} weeks` : ""}`; }
    else {
      // Holding, or stalled: the last 3 sessions all within 1% and none above the previous period's best
      const last3 = a.slice(-3);
      const flat = last3.length === 3 && Math.max(...last3.map((p) => p.e)) - Math.min(...last3.map((p) => p.e)) <= Math.max(...last3.map((p) => p.e)) * 0.01;
      const top = last3.length ? last3[last3.length - 1].sets.reduce((m, s) => (s.weight_kg > m.weight_kg || (s.weight_kg === m.weight_kg && s.reps > m.reps) ? s : m)) : null;
      if (flat && (before == null || (now ?? 0) <= before) && top) { status = "stalled"; reason = `Last 3 sessions level, top set ${top.weight_kg} kg × ${top.reps}`; }
      else { status = "hold"; reason = `${fmt1(rate)}% a week${change != null ? `, best ${fmt1(change)}% vs previous ${weeks} weeks` : ""}`; }
    }
    lifts.push({ id, name: exMap.get(id)?.name ?? "Exercise", sessions: a.length, now, before, change, slope, points: pts.map((p) => ({ t: p.t, e: p.e })), status, reason });
  }
  const order: Record<LiftStatus, number> = { down: 0, stalled: 1, up: 2, hold: 3, few: 4 };
  lifts.sort((x, y) => order[x.status] - order[y.status] || (y.slope ?? y.change ?? 0) - (x.slope ?? x.change ?? 0));
  const counts = { up: 0, hold: 0, stalled: 0, down: 0, few: 0 } as Record<LiftStatus, number>;
  for (const l of lifts) counts[l.status]++;

  // ---- key numbers ----
  const setsOf = (ws: Workout[]) => ws.reduce((a, w) => a + w.sets.filter((s) => isWorking(s) && s.reps > 0).length, 0);
  const rpes = (ws: Workout[]) => ws.flatMap((w) => w.sets.filter((s) => isWorking(s) && s.rpe != null).map((s) => s.rpe!));
  const sessionsPerWeek = { now: wA.length / weeks, before: wB.length ? wB.length / weeks : null };
  const setsPerWeek = { now: setsOf(wA) / weeks, before: wB.length ? setsOf(wB) / weeks : null };
  const avgRpe = { now: avg(rpes(wA)), before: avg(rpes(wB)) };
  const medianChange = median(lifts.filter((l) => l.status !== "few" && l.change != null).map((l) => l.change!));

  // ---- context ----
  const dayIn = (d: string, a: number, b: number) => { const t = new Date(`${d}T12:00:00`).getTime(); return t >= a && t < b; };
  const wts = nutrition.weights;
  const wtA = wts.filter((x) => dayIn(x.measured_on, from, end)), wtB = wts.filter((x) => dayIn(x.measured_on, prevFrom, from));
  const weight = { now: avg(wtA.map((x) => x.weight_kg)), before: avg(wtB.map((x) => x.weight_kg)) };
  const wChange = pct(weight.now, weight.before);
  // Weekly rate from the two periods' averages (steadier than a line through a few noisy weigh-ins)
  const weightRate = wChange != null ? wChange / weeks : null;
  const relative = medianChange != null && wChange != null ? medianChange - wChange : null;
  const ckA = checkins.filter((c) => inA(new Date(c.checked_at).getTime())), ckB = checkins.filter((c) => inB(new Date(c.checked_at).getTime()));
  const readiness = { now: avg(ckA.map((c) => c.score)), before: avg(ckB.map((c) => c.score)) };
  const sleepOf = (a: number, b: number) => {
    const hc = activity.filter((d) => d.sleep_minutes && dayIn(d.day, a, b)).map((d) => d.sleep_minutes! / 60);
    if (hc.length) return avg(hc);
    return avg(checkins.filter((c) => c.sleep_hours != null && (() => { const t = new Date(c.checked_at).getTime(); return t >= a && t < b; })()).map((c) => c.sleep_hours!));
  };
  const sleep = { now: sleepOf(from, end), before: sleepOf(prevFrom, from) };
  const totals = dayTotals(nutrition);
  const today = ymd(new Date(nowMs));
  const foodDays = [...totals.values()].filter((d) => d.entries > 0 && d.day < today && dayIn(d.day, from, end));
  const tgt = foodDays.map((d) => targetFor(nutrition.targets, d.day)).filter((t): t is NonNullable<typeof t> => !!t);
  const kcal = { avg: avg(foodDays.map((d) => d.kcal)), target: avg(tgt.map((t) => t.kcal).filter((x): x is number => x != null)) };
  const protein = { avg: avg(foodDays.map((d) => d.protein)), target: avg(tgt.map((t) => t.protein).filter((x): x is number => x != null)) };

  // ---- headline ----
  const trended = counts.up + counts.hold + counts.stalled + counts.down;
  let headline: string, tone: StrengthReport["tone"];
  const tally = [counts.up && `${counts.up} up`, (counts.hold + counts.stalled) && `${counts.hold + counts.stalled} level`, counts.down && `${counts.down} down`].filter(Boolean).join(", ");
  if (!trended) { headline = `Not enough sessions yet to read a trend: keep logging and this fills in after a couple of weeks.`; tone = "watch"; }
  else if (phase === "deficit") {
    if (counts.down === 0) { headline = `Strength holding well in a deficit: ${tally} over the last ${weeks} weeks.`; tone = "good"; }
    else if (counts.down <= Math.max(1, trended * 0.25)) { headline = `Mostly holding in the deficit: ${tally}. Keep an eye on the lift${counts.down === 1 ? "" : "s"} slipping.`; tone = "watch"; }
    else { headline = `Strength dipping in the deficit: ${tally}. Recovery or the size of the deficit may need a look.`; tone = "bad"; }
  } else {
    if (counts.up > counts.down && counts.up >= trended / 3) { headline = `Strength is climbing: ${tally} over the last ${weeks} weeks.`; tone = "good"; }
    else if (counts.down > counts.up) { headline = `More lifts slipping than progressing: ${tally}.`; tone = "bad"; }
    else { headline = `Strength mostly level: ${tally} over the last ${weeks} weeks.`; tone = "watch"; }
  }

  // ---- flags (most important first, at most 4) ----
  const flags: Flag[] = [];
  const names = (ls: LiftTrend[]) => ls.slice(0, 3).map((l) => l.name).join(", ") + (ls.length > 3 ? ` and ${ls.length - 3} more` : "");
  const downs = lifts.filter((l) => l.status === "down"), stalls = lifts.filter((l) => l.status === "stalled");
  if (downs.length >= 2) flags.push({ tone: "bad", text: `${names(downs)} slipping. With more than one lift down, a deload week or a smaller deficit for a week is worth considering.` });
  else if (downs.length === 1) flags.push({ tone: "watch", text: `${downs[0].name} slipping (${downs[0].reason}). Check its rest times and RPE before adding load.` });
  if (stalls.length) flags.push({ tone: "watch", text: `${names(stalls)} stalled. Aim for one extra rep on the first set next time, or add a set, before changing the exercise.` });
  if (sessionsPerWeek.before != null && sessionsPerWeek.now < sessionsPerWeek.before - 0.5) flags.push({ tone: "watch", text: `Training dropped to ${sessionsPerWeek.now.toFixed(1)} sessions a week (from ${sessionsPerWeek.before.toFixed(1)}). Consistency matters more than anything else here.` });
  if (readiness.now != null && readiness.now < 60) flags.push({ tone: "watch", text: `Readiness has averaged ${Math.round(readiness.now)}: fatigue is building, which tends to show up in the lifts a week or two later.` });
  if (sleep.now != null && sleep.now < 6.5) flags.push({ tone: "watch", text: `Sleep averaging ${sleep.now.toFixed(1)} h. Under 7 h makes holding strength in a deficit noticeably harder.` });
  if (protein.avg != null && protein.target != null && protein.avg < protein.target * 0.9) flags.push({ tone: "watch", text: `Protein averaging ${Math.round(protein.avg)} g against a ${Math.round(protein.target)} g target. Closing that gap protects muscle in the cut.` });
  if (phase === "deficit" && weightRate != null && weightRate < -1 && downs.length) flags.push({ tone: "bad", text: `Weight dropping ${Math.abs(weightRate).toFixed(1)}% a week with lifts slipping: faster than the 0.5–1% that protects strength.` });
  if (!flags.length && trended) flags.push({ tone: "good", text: phase === "deficit" ? "Every lift is holding or up while you lose weight: keep the current plan." : "No warning signs: keep the current plan and progression." });
  if (relative != null && relative > 1 && flags.length < 4) flags.push({ tone: "good", text: wChange != null && wChange < -0.3 ? `Relative strength up ${relative.toFixed(1)}%: your lifts are holding or rising on less bodyweight.` : `Relative strength up ${relative.toFixed(1)}%: your lifts are rising faster than your bodyweight.` });

  return {
    weeks, from, phase, headline, tone, counts, sessionsPerWeek, setsPerWeek, avgRpe, medianChange, lifts,
    context: { weight, weightRate, relative, readiness, sleep, kcal, protein },
    flags: flags.slice(0, 4),
  };
}
