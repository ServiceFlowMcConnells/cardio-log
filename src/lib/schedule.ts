// Weekly planner: which template on which day, plus rules-based advice on frequency and spacing.
//
// Evidence used (Stronger by Science's frequency meta-analysis, building on Schoenfeld et al. 2016):
//  - Weekly hard sets per muscle are the main driver. Under ~10 a week counts as low volume.
//  - Training a muscle 2+ times a week grows it a bit more than once, even with sets matched; each extra
//    day adds roughly a fifth more growth. Once a week still works, just slower.
//  - Recovery typically takes 2–4 days; back-to-back days aren't harmful, but long gaps turn 2x into 1x.
import { supabase } from "./supabase";
import type { Exercise, Muscle, Template, Workout } from "./strength";
import { MUSCLE_LABEL } from "./strength";
import type { Phase } from "./readiness";

export interface PlannedWorkout { id: string; planned_on: string; template_id: string }

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDaysYmd = (s: string, n: number) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a: string, b: string) => Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
export const nextDays = (n = 7, from = new Date()) => Array.from({ length: n }, (_, i) => addDaysYmd(ymd(from), i));

export async function loadPlanned(): Promise<PlannedWorkout[]> {
  const since = addDaysYmd(ymd(new Date()), -21);
  const { data, error } = await supabase.from("planned_workouts").select("id, planned_on, template_id").gte("planned_on", since).order("planned_on");
  if (error) throw error;
  return (data ?? []) as PlannedWorkout[];
}

/** Replace the plan for the given dates with `rows` (dates without a row become rest days). */
export async function savePlan(dates: string[], rows: { planned_on: string; template_id: string }[]): Promise<void> {
  if (!dates.length) return;
  const { error: delErr } = await supabase.from("planned_workouts").delete().in("planned_on", dates);
  if (delErr) throw delErr;
  if (rows.length) {
    const { error } = await supabase.from("planned_workouts").insert(rows);
    if (error) throw error;
  }
}

/** Was this planned day trained (a workout from that template on that date)? */
export function plannedStatus(p: PlannedWorkout, workouts: Workout[], today = ymd(new Date())): "done" | "today" | "planned" | "missed" | "other" {
  const sameDay = workouts.filter((w) => ymd(new Date(w.started_at)) === p.planned_on);
  if (sameDay.some((w) => w.template_id === p.template_id)) return "done";
  if (sameDay.length) return "other";
  if (p.planned_on === today) return "today";
  return p.planned_on < today ? "missed" : "planned";
}

/** Short label for a template in a day pill: "Hypertrophy A" → "A", "Upper Body" → "UB". */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (words.length > 1 && /^[A-Za-z0-9]{1,2}$/.test(last)) return last.toUpperCase();
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "W";
}

// ---------- Advice ----------

const MAJOR: Muscle[] = ["chest", "back", "shoulders", "quads", "hamstrings", "glutes"];
// Muscles that also get meaningful work from another muscle's main lifts (counted as half a set)
const HELPS: Partial<Record<Muscle, Muscle[]>> = { chest: ["triceps", "shoulders"], back: ["biceps"], quads: ["glutes"], hamstrings: ["glutes"], full_body: ["quads", "back", "glutes"] };

export interface MuscleLoad { muscle: Muscle; sessions: number; sets: number; maxGap: number | null; backToBack: boolean }
export interface AdviceItem { tone: "good" | "warn" | "bad" | "neutral"; title: string; text: string }
export interface PlanAdvice { sessions: number; muscles: MuscleLoad[]; items: AdviceItem[]; verdict: AdviceItem["tone"] }

export function planAdvice(days: { date: string; template: Template | null }[], exercises: Exercise[], phase: Phase | null = null): PlanAdvice {
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const train = days.filter((d) => d.template).sort((a, b) => a.date.localeCompare(b.date));
  const sessions = train.length;
  const items: AdviceItem[] = [];
  if (!sessions) return { sessions, muscles: [], items: [{ tone: "neutral", title: "No sessions planned", text: "Pick the days you can train and the planner will check the spread." }], verdict: "neutral" };

  // Sets per muscle per session (primary muscle = full sets, helpers = half)
  const hits = new Map<Muscle, { date: string; sets: number }[]>();
  for (const d of train) {
    const per = new Map<Muscle, number>();
    for (const te of d.template!.exercises) {
      const ex = exMap.get(te.exercise_id);
      if (!ex || ex.muscle === "other") continue;
      const prim = ex.muscle === "full_body" ? [] : [ex.muscle];
      for (const m of prim) per.set(m, (per.get(m) ?? 0) + te.sets);
      for (const m of HELPS[ex.muscle] ?? []) per.set(m, (per.get(m) ?? 0) + te.sets * (ex.muscle === "full_body" ? 1 : 0.5));
    }
    for (const [m, sets] of per) if (sets >= 2) (hits.get(m) ?? hits.set(m, []).get(m)!).push({ date: d.date, sets });
  }
  const muscles: MuscleLoad[] = [...hits.entries()].map(([muscle, hs]) => {
    // Gaps between hits, assuming the week repeats (last hit → first hit next week)
    const gaps = hs.length > 1 ? [...hs.slice(1).map((h, i) => daysBetween(hs[i].date, h.date)), 7 - daysBetween(hs[0].date, hs[hs.length - 1].date)] : [];
    return { muscle, sessions: hs.length, sets: Math.round(hs.reduce((a, h) => a + h.sets, 0)), maxGap: gaps.length ? Math.max(...gaps) : null, backToBack: gaps.some((g) => g === 1) };
  }).sort((a, b) => (MAJOR.indexOf(a.muscle) + 1 || 99) - (MAJOR.indexOf(b.muscle) + 1 || 99));

  const majors = muscles.filter((m) => MAJOR.includes(m.muscle));
  const name = (ms: MuscleLoad[]) => ms.map((m) => MUSCLE_LABEL[m.muscle].toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1");
  const missing = MAJOR.filter((m) => !hits.has(m));

  // 1. Sessions per week
  if (sessions === 1) {
    items.push({ tone: "bad", title: "One session this week", text: "A single session keeps what you have but builds slowly. Two sessions roughly 3–4 days apart is the smallest week that trains each muscle twice." });
  } else if (sessions >= 2) {
    // 2. Spacing between sessions overall
    const dates = train.map((d) => d.date);
    const gaps = [...dates.slice(1).map((d, i) => daysBetween(dates[i], d)), 7 - daysBetween(dates[0], dates[dates.length - 1])];
    const worst = Math.max(...gaps);
    if (sessions === 2 && worst >= 5) {
      items.push({ tone: "warn", title: "Sessions are bunched together", text: `Your two sessions are ${daysBetween(dates[0], dates[1])} day${daysBetween(dates[0], dates[1]) === 1 ? "" : "s"} apart, then ${worst} days off. Spread them 3–4 days apart (e.g. Mon & Thu, or Tue & Fri) so each muscle is trained again before the effect of the last session fades.` });
    } else if (sessions >= 3 && worst >= 5) {
      items.push({ tone: "warn", title: `A ${worst}-day gap`, text: "Most of your week is packed together with a long break after. Even spacing keeps every muscle trained every 2–3 days." });
    }
  }

  // 3. Muscles trained only once (or not at all)
  const once = majors.filter((m) => m.sessions === 1);
  if (sessions >= 2 && once.length) {
    items.push({ tone: "warn", title: `${once.length === 1 ? "One muscle" : `${once.length} muscle groups`} only once a week`, text: `${cap(name(once))} ${once.length === 1 ? "is" : "are"} only trained in one session. Twice a week grows muscle a little faster than once with the same sets, so add a few sets for ${once.length === 1 ? "it" : "them"} to your other session${sessions > 2 ? "s" : ""}. With 2–3 days a week, full-body A/B sessions train everything twice; an upper/lower split only manages once.` });
  }
  if (missing.length && missing.length < MAJOR.length) {
    items.push({ tone: "neutral", title: "Not trained this week", text: `${cap(MAJOR.filter((m) => missing.includes(m)).map((m) => MUSCLE_LABEL[m].toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1"))}: no direct work planned. Fine if deliberate, or add an exercise.` });
  }

  // 4. Long gaps for a muscle trained 2x (effectively once a week)
  const gappy = majors.filter((m) => m.sessions >= 2 && (m.maxGap ?? 0) >= 5);
  if (gappy.length && !items.some((i) => i.title.startsWith("Sessions are bunched"))) {
    items.push({ tone: "warn", title: "Long gap for some muscles", text: `${cap(name(gappy))} ${gappy.length === 1 ? "goes" : "go"} ${Math.max(...gappy.map((m) => m.maxGap!))} days between sessions. Moving one session so the gap is 2–4 days gets more out of the same work.` });
  }

  // 5. Same muscles on back-to-back days (fine in moderation, worth knowing)
  const b2b = majors.filter((m) => m.backToBack && m.sets >= 8);
  if (b2b.length) {
    items.push({ tone: "neutral", title: "Back-to-back days", text: `${cap(name(b2b))} ${b2b.length === 1 ? "is" : "are"} trained on consecutive days. That isn't harmful, but you may carry fatigue into the second day. If reps drop, put a rest day between them.` });
  }

  // 6. Weekly volume
  const low = majors.filter((m) => m.sets < setTarget(m.muscle, phase).min);
  const high = majors.filter((m) => m.sets > setTarget(m.muscle, phase).max);
  if (low.length) {
    items.push({ tone: phase === "deficit" ? "neutral" : "warn", title: "Low weekly sets", text: `${cap(name(low))}: under ${setTarget("chest", phase).min} hard sets a week (${low.map((m) => `${MUSCLE_LABEL[m.muscle]} ${m.sets}`).join(", ")}). That's the low-volume range. ${phase === "deficit" ? "In a deficit it's enough to hold muscle if the sets are hard; add sets when you can recover from them." : "Adding a couple of sets per session there is the biggest lever for growth."}` });
  }
  if (high.length) {
    items.push({ tone: "warn", title: phase === "deficit" ? "High volume for a deficit" : "Very high weekly sets", text: `${cap(name(high))}: over ${setTarget("chest", phase).max} sets a week. ${phase === "deficit" ? "Recovery is limited in a deficit; if readiness keeps dropping, trim sets before cutting weight on the bar." : "Past this, extra sets add fatigue faster than growth for most people."}` });
  }

  const allTwice = majors.length > 0 && majors.every((m) => m.sessions >= 2 && (m.maxGap ?? 7) <= 4);
  if (allTwice && !items.some((i) => i.tone === "warn" || i.tone === "bad")) {
    items.unshift({ tone: "good", title: "Good spread", text: `Every trained muscle gets ${Math.min(...majors.map((m) => m.sessions))}+ sessions with no more than ${Math.max(...majors.map((m) => m.maxGap ?? 0))} days between them.` });
  }
  const verdict: AdviceItem["tone"] = items.some((i) => i.tone === "bad") ? "bad" : items.some((i) => i.tone === "warn") ? "warn" : items.some((i) => i.tone === "good") ? "good" : "neutral";
  return { sessions, muscles, items, verdict };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Evenly spaced days in the next week for `n` sessions, starting from the first day you can train. */
export function suggestDays(n: number, dates: string[]): string[] {
  if (n <= 0) return [];
  const step = 7 / n;
  const out: string[] = [];
  for (let i = 0; i < n && i < dates.length; i++) out.push(dates[Math.min(dates.length - 1, Math.round(i * step))]);
  return [...new Set(out)];
}

// ---------- Weekly set targets and suggestions ----------
// Hard sets per muscle per week. 10+ is where most growth research lands (SBS treats <10 as low volume);
// in a deficit ~10–16 holds and can still build, with recovery the limit. Smaller muscles get plenty of
// indirect work (triceps from pressing, biceps from rows), so their direct targets are lower.
// Per session, ~10 hard sets for one muscle is a sensible ceiling; past that, spread it over more days.

export interface SetTarget { min: number; max: number }
export const SESSION_CAP = 10;
const MAX_SETS_PER_EXERCISE = 5;

export function setTarget(muscle: Muscle, phase: Phase | null): SetTarget {
  const major = MAJOR.includes(muscle);
  if (!major) return phase === "surplus" ? { min: 8, max: 16 } : { min: 6, max: 12 };
  if (phase === "deficit") return { min: 10, max: 16 };
  if (phase === "surplus") return { min: 12, max: 22 };
  return { min: 10, max: 20 };
}

export interface TemplateChange { templateId: string; exerciseId: string; kind: "inc" | "dec" | "add"; by: number }
export interface VolumeSuggestion { muscle: Muscle; from: number; to: number; target: SetTarget; text: string; changes: TemplateChange[]; note?: string; full?: boolean }

const TARGET_MUSCLES: Muscle[] = ["chest", "back", "shoulders", "quads", "hamstrings", "glutes", "biceps", "triceps", "calves"];

export const SESSION_TOTAL_CAP = 24; // working sets per session, roughly 60–75 minutes

/** Concrete template edits that bring each muscle's weekly sets towards its target range for this plan.
 *  Shares spare room one set at a time to whichever muscle is furthest below target, keeping each session
 *  under ~24 working sets and each muscle under ~10 sets per session. */
export function volumeSuggestions(days: { date: string; template: Template | null }[], templates: Template[], exercises: Exercise[], phase: Phase | null): VolumeSuggestion[] {
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const occ = new Map<string, number>(); // planned sessions per template this week
  for (const d of days) if (d.template) occ.set(d.template.id, (occ.get(d.template.id) ?? 0) + 1);
  if (!occ.size) return [];
  const planned = templates.filter((t) => occ.has(t.id));
  // Working copy: per template, list of { exerciseId, sets, isNew }
  const work = new Map(planned.map((t) => [t.id, t.exercises.map((te) => ({ exerciseId: te.exercise_id, sets: te.sets, isNew: false, base: te.sets }))]));
  const muscleOf = (id: string) => exMap.get(id)?.muscle;
  const weekly = (m: Muscle) => {
    let n = 0;
    for (const t of planned) for (const e of work.get(t.id)!) {
      const em = muscleOf(e.exerciseId);
      if (!em) continue;
      if (em === m) n += e.sets * occ.get(t.id)!;
      else if ((HELPS[em] ?? []).includes(m)) n += e.sets * (em === "full_body" ? 1 : 0.5) * occ.get(t.id)!;
    }
    return Math.round(n);
  };
  const sessionTotal = (tid: string) => work.get(tid)!.reduce((a, e) => a + e.sets, 0);
  const muscleInSession = (tid: string, m: Muscle) => work.get(tid)!.reduce((a, e) => a + (muscleOf(e.exerciseId) === m ? e.sets : 0), 0);
  const sessionsWith = (m: Muscle) => planned.filter((t) => muscleInSession(t.id, m) > 0).reduce((a, t) => a + occ.get(t.id)!, 0);

  const targets = new Map(TARGET_MUSCLES.map((m) => [m, setTarget(m, phase)]));
  const start = new Map(TARGET_MUSCLES.map((m) => [m, weekly(m)]));
  const skip = new Set<Muscle>();
  const notes = new Map<Muscle, string>();
  const full = new Set<Muscle>();
  // Leave arm/calf work alone for someone who doesn't train it directly
  for (const m of TARGET_MUSCLES) if (!MAJOR.includes(m) && !planned.some((t) => work.get(t.id)!.some((e) => muscleOf(e.exerciseId) === m))) skip.add(m);

  /** One step for muscle m. Returns false if there's no room. */
  const step = (m: Muscle): boolean => {
    // Trained in only one session but more are planned: add an exercise to another session (frequency first)
    if (MAJOR.includes(m) && sessionsWith(m) < 2) {
      const host = planned.filter((t) => muscleInSession(t.id, m) === 0 && sessionTotal(t.id) + 2 <= SESSION_TOTAL_CAP).sort((a, b) => sessionTotal(a.id) - sessionTotal(b.id))[0];
      const pick = host ? pickExercise(m, templates, exercises, work.get(host.id)!.map((e) => e.exerciseId)) : null;
      if (host && pick) { work.get(host.id)!.push({ exerciseId: pick.id, sets: 2, isNew: true, base: 0 }); return true; }
    }
    // Add a set to an existing exercise for m, the one with fewest sets in the roomiest session
    const cands: { tid: string; i: number; sets: number }[] = [];
    for (const t of planned) work.get(t.id)!.forEach((e, i) => {
      if (muscleOf(e.exerciseId) !== m || e.sets >= MAX_SETS_PER_EXERCISE) return;
      if (muscleInSession(t.id, m) >= SESSION_CAP || sessionTotal(t.id) >= SESSION_TOTAL_CAP) return;
      cands.push({ tid: t.id, i, sets: e.sets });
    });
    cands.sort((a, b) => a.sets - b.sets || sessionTotal(a.tid) - sessionTotal(b.tid));
    if (cands[0]) { work.get(cands[0].tid)![cands[0].i].sets++; return true; }
    // Existing exercises are full: add another exercise for m where there's room
    const host = planned.filter((t) => muscleInSession(t.id, m) + 2 <= SESSION_CAP && sessionTotal(t.id) + 2 <= SESSION_TOTAL_CAP).sort((a, b) => muscleInSession(a.id, m) - muscleInSession(b.id, m) || sessionTotal(a.id) - sessionTotal(b.id))[0];
    if (host) {
      const pick = pickExercise(m, templates, exercises, work.get(host.id)!.map((e) => e.exerciseId));
      if (pick) { work.get(host.id)!.push({ exerciseId: pick.id, sets: 2, isNew: true, base: 0 }); return true; }
      notes.set(m, `Add another ${MUSCLE_LABEL[m].toLowerCase()} exercise to your library and the planner can fit more sets in.`);
      return false;
    }
    full.add(m);
    return false;
  };

  for (let guard = 0; guard < 200; guard++) {
    const short = TARGET_MUSCLES.filter((m) => !skip.has(m) && weekly(m) < targets.get(m)!.min)
      .sort((a, b) => (weekly(a) / targets.get(a)!.min) - (weekly(b) / targets.get(b)!.min) || (MAJOR.includes(b) ? 1 : 0) - (MAJOR.includes(a) ? 1 : 0));
    if (!short.length) break;
    let moved = false;
    for (const m of short) { if (step(m)) { moved = true; break; } skip.add(m); }
    if (!moved) break;
  }
  // Over the top of the range: take sets off the biggest exercise for that muscle (never below 2)
  for (const m of TARGET_MUSCLES) {
    for (let guard = 0; weekly(m) > targets.get(m)!.max && guard < 30; guard++) {
      const c = planned.flatMap((t) => work.get(t.id)!.map((e, i) => ({ tid: t.id, i, e }))).filter((x) => muscleOf(x.e.exerciseId) === m && x.e.sets > 2).sort((a, b) => b.e.sets - a.e.sets)[0];
      if (!c) break;
      c.e.sets--;
    }
  }

  const tName = (id: string) => templates.find((t) => t.id === id)?.name ?? "workout";
  const eName = (id: string) => exMap.get(id)?.name ?? "exercise";
  const out: VolumeSuggestion[] = [];
  for (const m of TARGET_MUSCLES) {
    const changes: TemplateChange[] = [];
    for (const t of planned) for (const e of work.get(t.id)!) {
      if (muscleOf(e.exerciseId) !== m) continue;
      if (e.isNew) changes.push({ templateId: t.id, exerciseId: e.exerciseId, kind: "add", by: e.sets });
      else if (e.sets !== e.base) changes.push({ templateId: t.id, exerciseId: e.exerciseId, kind: e.sets > e.base ? "inc" : "dec", by: Math.abs(e.sets - e.base) });
    }
    const note = notes.get(m);
    if (!changes.length && !note && !full.has(m)) continue;
    const parts = changes.map((c) => c.kind === "add" ? `add ${eName(c.exerciseId)} × ${c.by} sets to ${tName(c.templateId)}` : `${c.kind === "inc" ? "+" : "−"}${c.by} set${c.by === 1 ? "" : "s"} ${eName(c.exerciseId)} (${tName(c.templateId)})`);
    out.push({ muscle: m, from: start.get(m)!, to: weekly(m), target: targets.get(m)!, changes, note, full: full.has(m) && weekly(m) < targets.get(m)!.min, text: parts.length ? cap(parts.join(", ")) + "." : "" });
  }
  return out;
}

/** Session totals after applying all suggestions, for the summary line. */
export function sessionTotalsAfter(templates: Template[], changes: TemplateChange[]): Map<string, number> {
  const after = applyChanges(templates, changes);
  return new Map(after.map((t) => [t.id, t.exercises.reduce((a, e) => a + e.sets, 0)]));
}

/** An exercise for a muscle: one you already use in a template, else any in your library. */
function pickExercise(m: Muscle, templates: Template[], exercises: Exercise[], avoidIds: string[] = []): Exercise | null {
  const live = exercises.filter((e) => e.muscle === m && !e.archived);
  const inAvoid = new Set(avoidIds);
  const used = live.filter((e) => templates.some((t) => t.exercises.some((te) => te.exercise_id === e.id)) && !inAvoid.has(e.id));
  return used[0] ?? live.find((e) => !inAvoid.has(e.id)) ?? null;
}

/** Templates with suggestion changes applied (for saving). */
export function applyChanges(templates: Template[], changes: TemplateChange[]): Template[] {
  const touched = new Map<string, Template>();
  for (const c of changes) {
    const t = touched.get(c.templateId) ?? structuredClone(templates.find((x) => x.id === c.templateId));
    if (!t) continue;
    if (c.kind === "add") {
      t.exercises.push({ exercise_id: c.exerciseId, position: t.exercises.length, sets: c.by, rep_min: 8, rep_max: 12, target_rpe: 8, rest_sec: null, notes: null, progression: "rep_range", on_stall: "preserve", increment_kg: null });
    } else {
      const te = t.exercises.find((e) => e.exercise_id === c.exerciseId);
      if (te) te.sets = Math.max(1, Math.min(10, te.sets + (c.kind === "inc" ? c.by : -c.by)));
    }
    touched.set(t.id, t);
  }
  return [...touched.values()];
}
