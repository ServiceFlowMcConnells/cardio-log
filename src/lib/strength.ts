// Strength training types and calculations.
//
// Estimated 1RM methods (selectable in Settings):
//  - "rpe":     RTS / Tuchscherer RPE chart. %1RM is looked up from reps + reps-in-reserve (10 − RPE).
//  - "epley":   1RM = w × (1 + r/30)
//  - "brzycki": 1RM = w × 36 / (37 − r)
// For all three, logged RPE turns into reps in reserve, so 100 kg × 5 @ RPE 8 is treated like 7 reps to failure.
// Sets without an RPE are assumed to be taken close to failure (RPE 10), the standard assumption in Strong-style apps.

export type Muscle =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps" | "quads"
  | "hamstrings" | "glutes" | "calves" | "core" | "full_body" | "other";
export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "smith" | "other";
export type SetType = "warmup" | "working" | "drop" | "failure";
export type E1rmFormula = "rpe" | "epley" | "brzycki";

export const MUSCLES: Muscle[] = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core", "full_body", "other"];
export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", quads: "Quads",
  hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", core: "Core", full_body: "Full body", other: "Other",
};
export const EQUIPMENT: Equipment[] = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "smith", "other"];
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: "Barbell", dumbbell: "Dumbbell", machine: "Machine", cable: "Cable", bodyweight: "Bodyweight",
  kettlebell: "Kettlebell", smith: "Smith machine", other: "Other",
};
export const SET_TYPE_SHORT: Record<SetType, string> = { warmup: "W", working: "", drop: "D", failure: "F" };
export const SET_TYPE_LABEL: Record<SetType, string> = { warmup: "Warm-up", working: "Working", drop: "Drop set", failure: "To failure" };

export interface Exercise {
  id: string;
  name: string;
  muscle: Muscle;
  equipment: Equipment;
  notes: string | null;
  archived: boolean;
  increment_kg: number | null; // overrides the default weight jump
  secondary?: Muscle[] | null; // also trained (half a set each); null = inferred from the name
}

// ---------- Secondary muscles ----------
// Volume counting follows Pelland et al. 2024 (67 studies): counting a set at full value for the main muscle
// and half ("fractional") for muscles that also do real work through the movement predicted growth and
// strength best. Only prime movers count (triceps on bench, biceps on rows, glutes on squats), not muscles
// holding still (core on squats, forearms gripping). Isolation lifts have none.
export const SECONDARY_FRACTION = 0.5;
export const SECONDARY_MUSCLES: Muscle[] = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"];

/** Best guess at an exercise's secondary movers from its name and main muscle. */
export function inferSecondary(ex: Pick<Exercise, "name" | "muscle">): Muscle[] {
  const n = ex.name.toLowerCase();
  const out = new Set<Muscle>();
  const has = (re: RegExp) => re.test(n);
  const isolation = has(/\b(fly|flye|crossover|pec deck|raise|curl|extension|kickback|pushdown|pullover|shrug|crunch|plank|calf)\b/) && !has(/\b(leg press|press)\b/);
  if (!isolation) {
    if (has(/bench|chest press|push[- ]?up|press[- ]?up|floor press|incline|decline|dumbbell press/) && ex.muscle === "chest") { out.add("triceps"); out.add("shoulders"); }
    if (has(/close[- ]?grip|jm press/) && ex.muscle === "triceps") { out.add("chest"); out.add("shoulders"); }
    if (has(/\bdips?\b/)) { out.add(ex.muscle === "triceps" ? "chest" : "triceps"); out.add("shoulders"); }
    if (has(/overhead press|shoulder press|military|arnold|push press|\bohp\b|seated dumbbell press|landmine press/) && ex.muscle === "shoulders") out.add("triceps");
    if (has(/\brows?\b|pull[- ]?ups?|chin[- ]?ups?|pull[- ]?down|lat pull|inverted row|t-bar/) && ex.muscle === "back") out.add("biceps");
    if (has(/romanian|\brdl\b|stiff[- ]?leg|good morning/)) out.add(ex.muscle === "glutes" ? "hamstrings" : "glutes");
    else if (has(/deadlift/)) { out.add("glutes"); out.add("hamstrings"); }
    if (has(/squat|leg press|lunge|split squat|step[- ]?ups?|hack/)) out.add(ex.muscle === "glutes" ? "quads" : "glutes");
  }
  out.delete(ex.muscle);
  return [...out];
}

export const secondaryOf = (ex: Pick<Exercise, "name" | "muscle" | "secondary">): Muscle[] =>
  (ex.secondary ?? inferSecondary(ex)).filter((m) => m !== ex.muscle);

/** Sets credited to each muscle for `sets` sets of an exercise: 1 per set for the main muscle, 0.5 for secondaries. */
export function muscleCredit(ex: Pick<Exercise, "name" | "muscle" | "secondary">, sets: number): [Muscle, number][] {
  const out: [Muscle, number][] = [];
  if (ex.muscle !== "other" && ex.muscle !== "full_body") out.push([ex.muscle, sets]);
  for (const m of secondaryOf(ex)) out.push([m, sets * SECONDARY_FRACTION]);
  return out;
}

export interface TemplateExercise {
  id?: string;
  exercise_id: string;
  position: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  target_rpe: number | null;
  rest_sec: number | null;
  notes: string | null;
  progression?: "rep_range" | "fixed";
  on_stall?: "preserve" | "reset";
  increment_kg?: number | null;
}

export interface Template {
  id: string;
  name: string;
  notes: string | null;
  position: number;
  exercises: TemplateExercise[];
}

export interface WSet {
  id?: string;
  exercise_id: string;
  exercise_position: number;
  set_number: number;
  set_type: SetType;
  weight_kg: number;
  reps: number;
  rpe: number | null;
}

export interface Workout {
  id: string;
  template_id: string | null;
  checkin_id: string | null;
  program_id?: string | null; // the program step this workout completed, if any
  program_step?: number | null;
  name: string;
  started_at: string;
  duration_min: number | null;
  notes: string | null;
  sets: WSet[];
}

// ---------- %1RM tables ----------

// RTS RPE chart, RPE 10 column: %1RM for 1..12 reps, extended to 20 at the chart's ~2.7% per rep.
const RPE10 = [100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9, 57.4, 54.9, 52.4, 49.9, 47.4];
export const MAX_EST_REPS = 20; // beyond this an estimate is meaningless
export const RELIABLE_REPS = 12; // estimates above this are rough

/** Fraction of 1RM you can lift for `reps` with `rir` reps left in the tank. */
export function pctOf1rm(reps: number, rir: number, formula: E1rmFormula): number | null {
  const eff = reps + Math.max(0, rir);
  if (reps < 1 || eff > MAX_EST_REPS) return null;
  if (formula === "epley") return eff <= 1 ? 1 : 1 / (1 + eff / 30);
  if (formula === "brzycki") return eff >= 37 ? null : (37 - eff) / 36;
  const lo = Math.floor(eff);
  const hi = Math.ceil(eff);
  const a = RPE10[lo - 1];
  const b = RPE10[hi - 1];
  if (a == null || b == null) return null;
  return (a + (b - a) * (eff - lo)) / 100;
}

export const rirFromRpe = (rpe: number | null) => (rpe == null ? 0 : Math.max(0, 10 - rpe));

/** Estimated 1RM from one set. Null for warm-ups, zero-weight or very high-rep sets. */
export function e1rm(s: Pick<WSet, "weight_kg" | "reps" | "rpe" | "set_type">, formula: E1rmFormula): number | null {
  if (s.set_type === "warmup" || s.weight_kg <= 0 || s.reps < 1) return null;
  const p = pctOf1rm(s.reps, rirFromRpe(s.rpe), formula);
  return p ? s.weight_kg / p : null;
}

/** Load for `reps` at `rpe`, given a 1RM. */
export function loadFor(oneRm: number, reps: number, rpe: number | null, formula: E1rmFormula): number | null {
  const p = pctOf1rm(reps, rirFromRpe(rpe), formula);
  return p ? oneRm * p : null;
}

export function roundTo(kg: number, inc: number, mode: "nearest" | "down" = "nearest"): number {
  const f = mode === "down" ? Math.floor(kg / inc + 1e-9) : Math.round(kg / inc);
  return Math.round(f * inc * 100) / 100;
}

export const fmtKg = (kg: number) => (Math.round(kg * 100) / 100).toString();
export const fmtTonnage = (kg: number) => (kg >= 10000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg).toLocaleString("en-IE")} kg`);

// ---------- Workout maths ----------

export const isWorking = (s: WSet) => s.set_type !== "warmup";

/** Tonnage: weight × reps over working sets. */
export function volume(sets: WSet[]): number {
  return sets.filter(isWorking).reduce((a, s) => a + s.weight_kg * s.reps, 0);
}

export function totalReps(sets: WSet[]): number {
  return sets.filter(isWorking).reduce((a, s) => a + s.reps, 0);
}

export function bestE1rm(sets: WSet[], formula: E1rmFormula): number | null {
  let best: number | null = null;
  for (const s of sets) {
    const v = e1rm(s, formula);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** Mean %1RM of working sets, against a fixed reference 1RM. */
export function avgIntensity(sets: WSet[], ref: number | null): number | null {
  if (!ref) return null;
  const w = sets.filter((s) => isWorking(s) && s.weight_kg > 0);
  if (!w.length) return null;
  return w.reduce((a, s) => a + s.weight_kg / ref, 0) / w.length;
}

export function setsByExercise(w: Workout): Map<string, WSet[]> {
  const m = new Map<string, WSet[]>();
  const sorted = [...w.sets].sort((a, b) => a.exercise_position - b.exercise_position || a.set_number - b.set_number);
  for (const s of sorted) {
    if (!m.has(s.exercise_id)) m.set(s.exercise_id, []);
    m.get(s.exercise_id)!.push(s);
  }
  return m;
}

/** Workouts sorted newest first. Returns those strictly before `before` that include the exercise. */
export function previousFor(exerciseId: string, workouts: Workout[], before: string, excludeId?: string): { workout: Workout; sets: WSet[] } | null {
  for (const w of workouts) {
    if (w.id === excludeId || w.started_at >= before) continue;
    const sets = w.sets.filter((s) => s.exercise_id === exerciseId).sort((a, b) => a.set_number - b.set_number);
    if (sets.length) return { workout: w, sets };
  }
  return null;
}

/** Best e1RM for an exercise from workouts before a moment (the reference for intensity). */
export function bestE1rmBefore(exerciseId: string, workouts: Workout[], before: string, formula: E1rmFormula, excludeId?: string): number | null {
  let best: number | null = null;
  for (const w of workouts) {
    if (w.id === excludeId || w.started_at >= before) continue;
    const v = bestE1rm(w.sets.filter((s) => s.exercise_id === exerciseId), formula);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

// ---------- Personal records ----------
// Like Strong: a set beats everything you've logged before for that exercise. Each kind counts once per
// exercise per workout. Bodyweight lifts (no weight logged) get a reps record instead of weight/volume.
// Nothing counts the first time you do an exercise (there's nothing to beat yet).

export type PrKind = "e1rm" | "weight" | "volume" | "reps";
export const PR_LABEL: Record<PrKind, string> = { e1rm: "estimated 1RM", weight: "heaviest weight", volume: "best set volume", reps: "most reps" };

export function exercisePrs(exerciseId: string, sets: WSet[], history: Workout[], formula: E1rmFormula): PrKind[] {
  const work = sets.filter((s) => s.exercise_id === exerciseId && isWorking(s) && s.reps > 0);
  const prior = history.flatMap((x) => x.sets.filter((s) => s.exercise_id === exerciseId && isWorking(s) && s.reps > 0));
  if (!work.length || !prior.length) return [];
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const out: PrKind[] = [];
  const loaded = work.filter((s) => s.weight_kg > 0);
  if (loaded.length) {
    const priorLoaded = prior.filter((s) => s.weight_kg > 0);
    const best1 = (xs: WSet[]) => max(xs.map((s) => e1rm(s, formula) ?? 0));
    if (best1(loaded) > best1(priorLoaded) + 0.01 && best1(priorLoaded) > 0) out.push("e1rm");
    if (max(loaded.map((s) => s.weight_kg)) > max(priorLoaded.map((s) => s.weight_kg)) + 0.001) out.push("weight");
    if (max(loaded.map((s) => s.weight_kg * s.reps)) > max(priorLoaded.map((s) => s.weight_kg * s.reps)) + 0.001) out.push("volume");
  } else {
    const priorBw = prior.filter((s) => s.weight_kg <= 0);
    if (priorBw.length && max(work.map((s) => s.reps)) > max(priorBw.map((s) => s.reps))) out.push("reps");
  }
  return out;
}

/** Every record set in a workout, by exercise. */
export function workoutPrs(w: Workout, all: Workout[], formula: E1rmFormula): { count: number; byExercise: Map<string, PrKind[]> } {
  const history = all.filter((x) => x.id !== w.id && x.started_at < w.started_at);
  const byExercise = new Map<string, PrKind[]>();
  let count = 0;
  for (const [id, sets] of setsByExercise(w)) {
    const k = exercisePrs(id, sets, history, formula);
    if (k.length) { byExercise.set(id, k); count += k.length; }
  }
  return { count, byExercise };
}

export interface ExerciseComparison {
  exerciseId: string;
  sets: WSet[];
  volume: number;
  prevVolume: number | null;
  topE1rm: number | null;
  prevTopE1rm: number | null;
  intensity: number | null; // mean %1RM against reference
  prevIntensity: number | null;
  reference: number | null;
  prs: string[];
}

export type PrevPicker = (exerciseId: string) => { workout: Workout; sets: WSet[] } | null;

export function compareExercise(w: Workout, exerciseId: string, sets: WSet[], all: Workout[], formula: E1rmFormula, pick?: PrevPicker): ExerciseComparison {
  const prev = pick ? pick(exerciseId) : previousFor(exerciseId, all, w.started_at, w.id);
  const priorBest = bestE1rmBefore(exerciseId, all, w.started_at, formula, w.id);
  const topE1rm = bestE1rm(sets, formula);
  // Reference 1RM: your best going in. First time? Use today's best so intensity still shows.
  const reference = priorBest ?? topE1rm;
  const history = all.filter((x) => x.id !== w.id && x.started_at < w.started_at);
  const prs = exercisePrs(exerciseId, sets, history, formula).map((k) => PR_LABEL[k]);
  return {
    exerciseId,
    sets,
    volume: volume(sets),
    prevVolume: prev ? volume(prev.sets) : null,
    topE1rm,
    prevTopE1rm: prev ? bestE1rm(prev.sets, formula) : null,
    intensity: avgIntensity(sets, reference),
    prevIntensity: prev ? avgIntensity(prev.sets, reference) : null,
    reference,
    prs,
  };
}

/** A workout's average intensity: each exercise's mean %1RM (against your best e1RM going in, or that
 *  day's best the first time), averaged across exercises. Same figure as the post-workout summary. */
export function workoutIntensity(w: Workout, all: Workout[], formula: E1rmFormula): number | null {
  const vals: number[] = [];
  for (const [id, sets] of setsByExercise(w)) {
    const ref = bestE1rmBefore(id, all, w.started_at, formula, w.id) ?? bestE1rm(sets, formula);
    const v = avgIntensity(sets, ref);
    if (v != null) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** The workout to compare against: last one from the same template, otherwise the same name. */
export function previousWorkout(w: Workout, all: Workout[]): Workout | null {
  const earlier = all.filter((x) => x.id !== w.id && x.started_at < w.started_at);
  return (
    (w.template_id && earlier.find((x) => x.template_id === w.template_id)) ||
    earlier.find((x) => x.name.trim().toLowerCase() === w.name.trim().toLowerCase()) ||
    null
  );
}

export interface WorkoutComparison {
  volume: number;
  prevVolume: number | null;
  intensity: number | null;
  prevIntensity: number | null;
  workingSets: number;
  exercises: ExerciseComparison[];
  previous: Workout | null;
  prCount: number;
}

/** `pick` chooses each exercise's previous session (the app passes a rep-range-aware one). */
export function compareWorkout(w: Workout, all: Workout[], formula: E1rmFormula, pick?: PrevPicker): WorkoutComparison {
  const exercises = [...setsByExercise(w).entries()].map(([id, sets]) => compareExercise(w, id, sets, all, formula, pick));
  const previous = previousWorkout(w, all);
  // Intensity: average of per-exercise mean %1RM, each against the same reference 1RM, so the two workouts are comparable.
  const ints = exercises.filter((e) => e.intensity != null);
  const intensity = ints.length ? ints.reduce((a, e) => a + (e.intensity as number), 0) / ints.length : null;
  let prevIntensity: number | null = null;
  if (previous) {
    const vals: number[] = [];
    for (const e of exercises) {
      const ps = previous.sets.filter((s) => s.exercise_id === e.exerciseId);
      const v = avgIntensity(ps, e.reference);
      if (v != null) vals.push(v);
    }
    prevIntensity = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return {
    volume: volume(w.sets),
    prevVolume: previous ? volume(previous.sets) : null,
    intensity,
    prevIntensity,
    workingSets: w.sets.filter(isWorking).length,
    exercises,
    previous,
    prCount: exercises.reduce((a, e) => a + e.prs.length, 0),
  };
}

export function pctChange(now: number | null, before: number | null): number | null {
  if (now == null || before == null || before === 0) return null;
  return ((now - before) / before) * 100;
}

/** Hard sets per muscle (working sets at RPE 7+ or no RPE logged) for a list of workouts. */
export function hardSetsByMuscle(workouts: Workout[], exercises: Map<string, Exercise>): Map<Muscle, number> {
  const m = new Map<Muscle, number>();
  for (const w of workouts) {
    for (const s of w.sets) {
      if (!isWorking(s) || (s.rpe != null && s.rpe < 7)) continue;
      const ex = exercises.get(s.exercise_id);
      if (!ex) { m.set("other", (m.get("other") ?? 0) + 1); continue; }
      // Main muscle 1 set, secondary movers half a set (fractional counting)
      const credit = muscleCredit(ex, 1);
      if (!credit.length) m.set(ex.muscle, (m.get(ex.muscle) ?? 0) + 1);
      for (const [mu, n] of credit) m.set(mu, (m.get(mu) ?? 0) + n);
    }
  }
  return m;
}

/** Double progression hint: if every working set reached the top of the rep range last time, add weight. */
export function progressionHint(prevSets: WSet[] | null, repMax: number, increment: number): { addKg: number; from: number } | null {
  if (!prevSets) return null;
  const work = prevSets.filter((s) => isWorking(s) && s.weight_kg > 0);
  if (!work.length) return null;
  const top = Math.max(...work.map((s) => s.weight_kg));
  const atTop = work.filter((s) => s.weight_kg === top);
  if (atTop.every((s) => s.reps >= repMax)) return { addKg: increment, from: top };
  return null;
}

export const REP_MAX_ROWS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];

export const COMMON_EXERCISES: { name: string; muscle: Muscle; equipment: Equipment }[] = [
  { name: "Back Squat", muscle: "quads", equipment: "barbell" },
  { name: "Front Squat", muscle: "quads", equipment: "barbell" },
  { name: "Leg Press", muscle: "quads", equipment: "machine" },
  { name: "Leg Extension", muscle: "quads", equipment: "machine" },
  { name: "Bulgarian Split Squat", muscle: "quads", equipment: "dumbbell" },
  { name: "Deadlift", muscle: "back", equipment: "barbell" },
  { name: "Romanian Deadlift", muscle: "hamstrings", equipment: "barbell" },
  { name: "Lying Leg Curl", muscle: "hamstrings", equipment: "machine" },
  { name: "Hip Thrust", muscle: "glutes", equipment: "barbell" },
  { name: "Standing Calf Raise", muscle: "calves", equipment: "machine" },
  { name: "Bench Press", muscle: "chest", equipment: "barbell" },
  { name: "Incline Dumbbell Press", muscle: "chest", equipment: "dumbbell" },
  { name: "Chest Press", muscle: "chest", equipment: "machine" },
  { name: "Cable Fly", muscle: "chest", equipment: "cable" },
  { name: "Dip", muscle: "chest", equipment: "bodyweight" },
  { name: "Overhead Press", muscle: "shoulders", equipment: "barbell" },
  { name: "Seated Dumbbell Press", muscle: "shoulders", equipment: "dumbbell" },
  { name: "Lateral Raise", muscle: "shoulders", equipment: "dumbbell" },
  { name: "Rear Delt Fly", muscle: "shoulders", equipment: "machine" },
  { name: "Pull-up", muscle: "back", equipment: "bodyweight" },
  { name: "Lat Pulldown", muscle: "back", equipment: "cable" },
  { name: "Barbell Row", muscle: "back", equipment: "barbell" },
  { name: "Seated Cable Row", muscle: "back", equipment: "cable" },
  { name: "Barbell Curl", muscle: "biceps", equipment: "barbell" },
  { name: "Dumbbell Curl", muscle: "biceps", equipment: "dumbbell" },
  { name: "Triceps Pushdown", muscle: "triceps", equipment: "cable" },
  { name: "Overhead Triceps Extension", muscle: "triceps", equipment: "cable" },
  { name: "Plank", muscle: "core", equipment: "bodyweight" },
  { name: "Cable Crunch", muscle: "core", equipment: "cable" },
];

// ---------- Working-weight suggestions ----------
//
// Anchored to what you actually lifted (double progression), not extrapolated from a single best set:
//  1. If you trained this exercise last time in a similar rep range, start from that working weight.
//     - Hit the top of the rep range on every top-weight set, at or under the target RPE: add one increment.
//     - Fell short of the bottom of the range on 2+ sets: drop ~5%.
//     - Otherwise: same weight, beat last time's reps.
//  2. No comparable previous session (new exercise or new rep range): load from your *recent* estimated 1RM
//     (average across the last session's working sets, not the single best set, since RPE ratings on
//     high-rep sets are optimistic), for the bottom of the rep range at the target RPE, rounded down.
//     Never more than one increment above anything you've lifted for this exercise recently.
//  3. Readiness then scales the result down on poor days (never up).

/** e1RM for one session: average of working sets, preferring sets within 12 effective reps (more reliable). */
export function sessionE1rm(sets: WSet[], formula: E1rmFormula): number | null {
  const est = sets
    .filter((s) => isWorking(s) && s.weight_kg > 0 && s.reps >= 1)
    .map((s) => ({ v: e1rm(s, formula), eff: s.reps + rirFromRpe(s.rpe) }))
    .filter((x): x is { v: number; eff: number } => x.v != null);
  if (!est.length) return null;
  const reliable = est.filter((x) => x.eff <= RELIABLE_REPS);
  const use = reliable.length ? reliable : est;
  return use.reduce((a, x) => a + x.v, 0) / use.length;
}

/** Recent training e1RM: the most recent session's average estimate (within 8 weeks). */
export function trainingE1rm(exerciseId: string, workouts: Workout[], before: string, formula: E1rmFormula, excludeId?: string): number | null {
  const limit = new Date(before).getTime() - 56 * 86400000;
  for (const w of workouts) {
    if (w.id === excludeId || w.started_at >= before) continue;
    if (new Date(w.started_at).getTime() < limit) break;
    const v = sessionE1rm(w.sets.filter((s) => s.exercise_id === exerciseId), formula);
    if (v != null) return v;
  }
  return null;
}

export interface PlanLike { rep_min: number; rep_max: number; target_rpe: number | null }
export interface Suggestion {
  kg: number | null;
  why: string | null;
  increased: boolean; // load went up vs last time (aim for bottom of rep range)
}

export function suggestWorking(
  exerciseId: string,
  plan: PlanLike | null,
  workouts: Workout[],
  before: string,
  opts: { formula: E1rmFormula; inc: number; excludeId?: string; loadFactor?: number; allowProgression?: boolean; readinessLabel?: string },
): Suggestion {
  const { formula, inc, excludeId } = opts;
  const factor = opts.loadFactor ?? 1;
  const allowProg = opts.allowProgression ?? true;
  const prev = previousFor(exerciseId, workouts, before, excludeId);
  const prevWork = prev ? prev.sets.filter((s) => isWorking(s) && s.weight_kg > 0) : [];
  const lastTop = prevWork.length ? Math.max(...prevWork.map((s) => s.weight_kg)) : 0;
  const atTop = prevWork.filter((s) => s.weight_kg === lastTop);
  let kg: number | null = null;
  let why: string | null = null;
  let increased = false;

  const repsList = atTop.map((s) => s.reps).join(", ");
  const comparable = plan && atTop.length > 0 && atTop.every((s) => s.reps >= plan.rep_min - 2 && s.reps <= plan.rep_max + 2);

  if (plan && comparable) {
    const rpeOk = (s: WSet) => s.rpe == null || plan.target_rpe == null || s.rpe <= plan.target_rpe + 0.5;
    const allTop = atTop.every((s) => s.reps >= plan.rep_max);
    const earned = allTop && atTop.every(rpeOk);
    const missed = atTop.filter((s) => s.reps < plan.rep_min).length;
    const over = plan.target_rpe != null ? atTop.filter((s) => s.rpe != null && s.rpe > plan.target_rpe! + 1) : [];
    const maxOver = over.length ? Math.max(...over.map((s) => s.rpe as number)) : null;
    if (earned && allowProg) {
      kg = lastTop + inc;
      increased = true;
      why = `You hit ${plan.rep_max} reps on every set at ${fmtKg(lastTop)} kg last time. Add ${fmtKg(inc)} kg and aim for ${plan.rep_min}+`;
    } else if (earned) {
      kg = lastTop;
      why = `You've earned a weight increase, but readiness is ${opts.readinessLabel ?? "down"} today. Stay at ${fmtKg(lastTop)} kg and add weight next time`;
    } else if (allTop) {
      kg = lastTop;
      why = `You got ${plan.rep_max} on every set, but up to RPE ${Math.max(...atTop.map((s) => s.rpe ?? 0))}, above your target of ${plan.target_rpe}. Stay at ${fmtKg(lastTop)} kg until it feels like RPE ${plan.target_rpe}`;
    } else if (missed >= 2) {
      kg = roundTo(lastTop * 0.95, inc, "down");
      why = `You fell short of ${plan.rep_min} reps on ${missed} sets last time (${repsList}). Drop to ${fmtKg(kg)} kg and build back up`;
    } else {
      kg = lastTop;
      why = `Stay at ${fmtKg(lastTop)} kg and beat last time's reps (${repsList}). Add weight once every set reaches ${plan.rep_max}`;
    }
    if (maxOver != null && !allTop) why += `. Last time went to RPE ${maxOver}, above your target of ${plan.target_rpe}, so leave a rep or two in the tank`;
  } else if (plan?.target_rpe) {
    const ref = trainingE1rm(exerciseId, workouts, before, formula, excludeId);
    const l = ref ? loadFor(ref, plan.rep_min, plan.target_rpe, formula) : null;
    if (ref && l) {
      kg = roundTo(l, inc, "down");
      // Don't jump more than one increment above the heaviest recent working weight
      const recentMax = Math.max(0, ...workouts.filter((w) => w.id !== excludeId && w.started_at < before).slice(0, 6)
        .flatMap((w) => w.sets.filter((s) => s.exercise_id === exerciseId && isWorking(s)).map((s) => s.weight_kg)));
      if (recentMax > 0 && kg > recentMax + inc) kg = recentMax + inc;
      increased = lastTop > 0 && kg > lastTop;
      why = `${fmtKg(kg)} kg for ${plan.rep_min} reps at RPE ${plan.target_rpe}, from your recent estimated 1RM of ${fmtKg(Math.round(ref))} kg`;
    }
  } else if (lastTop > 0) {
    kg = lastTop;
  }

  if (kg != null && factor < 1) {
    const before2 = kg;
    kg = Math.min(roundTo(kg * factor, inc, "nearest"), kg - inc);
    increased = false;
    const pct = Math.round((1 - factor) * 100);
    why = `${why ? why + ". " : ""}Readiness: −${pct}% today, ${fmtKg(before2)} → ${fmtKg(kg)} kg`;
  }
  return { kg, why, increased };
}

// ---------- Warm-up ramps ----------
//
// Evidence base:
//  - Ribeiro et al. 2020 (IJERPH): warm-ups that include a set at ~80% of the working load improved squat
//    and bench performance more than light-only warm-ups; "few reps at low loads is not enough".
//  - Ribeiro et al.: 8 reps at ~64% 1RM beat 8 at ~32%; doing both was best.
//  - Sousa et al. 2024: a second warm-up at 90% 1RM beat one at 45% before squats to failure at 75% 1RM.
//  - Brazilian crossover (via Stronger by Science, 2024): 5 reps at 80% of 10RM gave more total volume
//    than 10 at 60% or 15 at 40%.
// So: ramp up in a few steps, reps fall as the weight rises (low fatigue), and the last warm-up is heavy
// (80–90% of the working weight). Heavier, lower-rep work gets more steps; high-rep work needs one.

export interface WarmupStep { kg: number; reps: number }

export function warmupRamp(working: number, reps: number, opts: { equipment: Equipment; inc: number }): WarmupStep[] {
  const { equipment, inc } = opts;
  if (working <= 0) {
    // Bodyweight: one easy primer set
    return equipment === "bodyweight" ? [{ kg: 0, reps: Math.max(3, Math.min(8, Math.round(reps / 2))) }] : [];
  }
  // [fraction of working weight, reps]
  let steps: [number, number][];
  if (reps <= 5) steps = [[0.4, 5], [0.6, 3], [0.75, 2], [0.9, 1]];
  else if (reps <= 8) steps = [[0.45, 8], [0.65, 5], [0.85, 3]];
  else if (reps <= 12) steps = [[0.5, 8], [0.8, 5]];
  else steps = [[0.6, 8]];
  // Dumbbells, cables and machines need less ramping than a loaded barbell
  if (equipment !== "barbell" && equipment !== "smith" && steps.length >= 3) steps = steps.slice(1);

  const bar = equipment === "barbell" ? 20 : 0;
  const out: WarmupStep[] = [];
  for (const [f, r] of steps) {
    let kg = Math.max(bar, roundTo(working * f, inc, "nearest"));
    if (kg >= working - inc / 2) continue; // too close to the working weight to be a warm-up
    if (kg <= 0) kg = inc;
    const last = out[out.length - 1];
    if (last && kg <= last.kg) {
      // Light weights round to the same number: keep the heavier step's lower reps only
      last.reps = Math.min(last.reps, r);
      continue;
    }
    out.push({ kg, reps: r });
  }
  // Empty-bar start for barbell lifts heavy enough to need it
  if (equipment === "barbell" && out.length && out[0].kg > bar && working >= 60 && reps <= 8) out.unshift({ kg: bar, reps: 10 });
  return out;
}
