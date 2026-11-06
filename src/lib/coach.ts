// Coach: a rules engine that prescribes each lift's next session and guards against strength slipping.
//
// Progression model: double progression with explicit rep goals.
//   Same weight until every working set reaches the top of the rep range at (or under) the target RPE,
//   adding one rep at a time to the weakest set. Then add one weight jump and rebuild reps.
//
// Decision order for each lift (first match wins):
//   deload      You've started a deload week: loads −10%, half the sets, RPE ≤ 7.
//   recover     Readiness "very low": loads −15%, one fewer set, RPE ≤ 7, no rep chasing.
//   new         No comparable history: load from your recent e1RM, bottom of the rep range.
//   protect     Strength slipping: session e1RM >4% below its 6-week peak in 2 of the last 3 sessions.
//               Keep the weight (intensity preserves strength), cut a set (less fatigue), don't chase reps.
//   reset       2+ sets below the rep range, or 3 sessions with no gain in reps or weight:
//               drop 5% (missed) or 7.5% (stalled) and rebuild towards the top of the range.
//   add_set     Same trigger, but one weight jump is over 15% (light dumbbells): add a set instead.
//   add_weight  Every top set hit the top of the range at ≤ target RPE + 0.5: +1 jump (+2 on an easy
//               lower-body barbell lift), rep goals predicted from your e1RM at the new weight.
//   consolidate Last time went over target RPE by more than 1: repeat the same weight and reps.
//   build_reps  Otherwise: same weight, +1 rep on the weakest set.
// Readiness then caps it: moderate/low days repeat last time's reps and scale the load down.

import type { E1rmFormula, Exercise, Template, WSet, Workout } from "./strength";
import { isWorking, loadFor, pctOf1rm, rirFromRpe, roundTo, sessionE1rm, trainingE1rm, fmtKg } from "./strength";
import type { Adjustment, Phase } from "./readiness";
import { LOW_RUN, adjustedRpe, adjustedSets } from "./readiness";

const DAY = 86400000;

export type CoachStatus = "new" | "build_reps" | "add_weight" | "add_set" | "consolidate" | "reset" | "protect" | "recover" | "deload" | "readiness_hold";

export const STATUS_LABEL: Record<CoachStatus, string> = {
  new: "Starting point",
  build_reps: "Build reps",
  add_weight: "Add weight",
  add_set: "Add a set",
  consolidate: "Consolidate",
  reset: "Reset & rebuild",
  protect: "Preserve muscle",
  recover: "Easy day",
  deload: "Deload",
  readiness_hold: "Hold for readiness",
};
// Tone for the status chip
export const STATUS_TONE: Record<CoachStatus, "good" | "neutral" | "warn" | "bad"> = {
  new: "neutral", build_reps: "good", add_weight: "good", add_set: "neutral", consolidate: "neutral", reset: "warn",
  protect: "bad", recover: "warn", deload: "warn", readiness_hold: "warn",
};

export type Progression = "rep_range" | "fixed";
export type OnStall = "preserve" | "reset";
export interface Plan {
  sets: number;
  rep_min: number;
  rep_max: number;
  target_rpe: number | null;
  progression?: Progression; // rep_range: build reps to the top, then add weight. fixed: add weight when every set hits the reps
  on_stall?: OnStall; // preserve: hold weight and trim volume when stuck or slipping. reset: drop 5–7.5% and rebuild
  increment_kg?: number | null; // weight jump for this exercise in this template
}

/** Plain-English rule for a template exercise. */
export function ruleText(plan: Plan, inc: number): string {
  const p = normalise(plan);
  const rpe = p.target_rpe ? ` @ RPE ${p.target_rpe}` : "";
  const grow = p.progression === "fixed"
    ? `Rule: ${p.sets} × ${p.rep_min}${rpe}. When every set hits ${p.rep_min}${p.target_rpe ? ` (averaging RPE ${p.target_rpe + 0.5} or easier)` : ""}, add ${fmtKg(inc)} kg.`
    : `Rule: ${p.sets} × ${p.rep_min}–${p.rep_max}${rpe}. Add a rep at a time until all ${p.sets} sets reach ${p.rep_max}${p.target_rpe ? ` (averaging RPE ${p.target_rpe + 0.5} or easier)` : ""}, then add ${fmtKg(inc)} kg and start back at ${p.rep_min}.`;
  const stall = p.on_stall === "reset"
    ? " If it stalls for 3 sessions or reps drop below the range, drop 5–7.5% and rebuild."
    : " If RPE stays high with no progress, or strength goes backwards, switch to preserving muscle: hold the weight, match your reps, trim a set.";
  return grow + stall;
}

function normalise(plan: Plan): Required<Omit<Plan, "increment_kg">> & { increment_kg: number | null } {
  const progression = plan.progression ?? (plan.rep_min === plan.rep_max ? "fixed" : "rep_range");
  return {
    ...plan,
    progression,
    rep_max: progression === "fixed" ? plan.rep_min : plan.rep_max,
    on_stall: plan.on_stall ?? "preserve",
    increment_kg: plan.increment_kg ?? null,
  };
}

export interface LiftHistory {
  sessions: { at: string; workoutId: string; sets: WSet[]; top: number; topReps: number[]; e1rm: number | null; factor: number }[]; // factor: readiness load cut (1 = full)
  peak6: number | null; // best session e1RM in the 6 weeks before the latest session
  latest: number | null;
  vsPeakPct: number | null; // latest vs 6-week peak (including latest), negative = below
  slipping: boolean;
  stalled: number; // sessions since the last gain in weight or reps
}

export interface Prescription {
  exerciseId: string;
  status: CoachStatus;
  weight: number | null;
  /** Per-set weights when sets differ (a top set and back-off sets); weight is then the first set's. */
  weights?: number[];
  reps: number[]; // goal per working set
  rpe: number | null; // stop at this RPE
  sets: number;
  headline: string; // "80 kg × 10, 10, 9 @ RPE 8"
  why: string;
  history: LiftHistory;
  plan: Plan;
}

export interface CoachOpts {
  formula: E1rmFormula;
  inc: number;
  adj: Adjustment | null;
  deload: boolean;
  excludeId?: string;
  phase?: Phase | null; // nutrition phase from the latest readiness scan
  lowRun?: number; // scans under 60 in the last 7 days (4+ = a low-readiness run)
}

const LOWER = new Set(["quads", "hamstrings", "glutes"]);

export function incrementFor(ex: Exercise | undefined, fallback: number): number {
  return ex?.increment_kg ?? fallback;
}

/** Working sets of an exercise in each past session, newest first. */
export function liftHistory(exerciseId: string, workouts: Workout[], before: string, formula: E1rmFormula, excludeId?: string, match?: (w: Workout, sets: WSet[]) => boolean): LiftHistory {
  const sessions: LiftHistory["sessions"] = [];
  for (const w of workouts) {
    if (w.id === excludeId || w.started_at >= before) continue;
    const sets = w.sets.filter((s) => s.exercise_id === exerciseId && isWorking(s) && s.reps > 0).sort((a, b) => a.set_number - b.set_number);
    if (!sets.length) continue;
    if (match && !match(w, sets)) continue;
    const top = Math.max(...sets.map((s) => s.weight_kg));
    sessions.push({ at: w.started_at, workoutId: w.id, sets, top, topReps: sets.filter((s) => s.weight_kg === top).map((s) => s.reps), e1rm: sessionE1rm(sets, formula), factor: w.load_factor ?? 1 });
  }
  const latest = sessions[0]?.e1rm ?? null;
  const latestT = sessions[0] ? new Date(sessions[0].at).getTime() : 0;
  const within = (s: { at: string }, days: number) => latestT - new Date(s.at).getTime() <= days * DAY;
  const earlier = sessions.slice(1).filter((s) => within(s, 42) && s.e1rm != null).map((s) => s.e1rm as number);
  const peak6 = earlier.length ? Math.max(...earlier) : null;
  const peakAll = Math.max(peak6 ?? 0, latest ?? 0) || null;
  const vsPeakPct = latest != null && peakAll ? ((latest - peakAll) / peakAll) * 100 : null;

  // Slipping: 2 of the last 3 sessions more than 4% under the peak that came before them
  let below = 0;
  for (let i = 0; i < Math.min(3, sessions.length); i++) {
    const s = sessions[i];
    const t = new Date(s.at).getTime();
    const prior = sessions.slice(i + 1).filter((p) => p.e1rm != null && t - new Date(p.at).getTime() <= 42 * DAY).map((p) => p.e1rm as number);
    if (s.e1rm != null && prior.length && s.e1rm < Math.max(...prior) * 0.96) below++;
  }
  const slipping = below >= 2;

  // Stalled: consecutive sessions (newest back) without beating the previous one's weight or total reps at top weight
  let stalled = 0;
  for (let i = 0; i < sessions.length - 1; i++) {
    const a = sessions[i], b = sessions[i + 1];
    const gained = a.top > b.top || (a.top === b.top && sum(a.topReps) > sum(b.topReps));
    if (gained) break;
    stalled++;
  }
  return { sessions, peak6, latest, vsPeakPct, slipping, stalled };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ---------- Rep ranges ----------
// One lift can be trained in different rep ranges (bench 8–10 on day A, 3–5 on day B). Progression is
// tracked per range: each range builds from the last session in that range, not the last bench session.
// Estimated 1RM, PRs and charts still use every session, so a new range starts from your real strength.

export interface RepRange { rep_min: number; rep_max: number }
export const rangesOverlap = (a: RepRange, b: RepRange) => a.rep_min <= b.rep_max && a.rep_max >= b.rep_min;
export const rangeLabel = (r: RepRange) => (r.rep_min === r.rep_max ? `${r.rep_min} reps` : `${r.rep_min}–${r.rep_max} reps`);

/** Does a past session of this exercise belong to `range`? By the template it was logged under (if that
 *  template has the exercise), otherwise by the reps actually done at the top weight. */
export function inRange(w: Workout, sets: WSet[], exerciseId: string, range: RepRange, templates: Template[]): boolean {
  const te = w.template_id ? templates.find((t) => t.id === w.template_id)?.exercises.find((e) => e.exercise_id === exerciseId) : undefined;
  if (te) return rangesOverlap(te, range);
  const top = Math.max(...sets.map((s) => s.weight_kg));
  const reps = sets.filter((s) => s.weight_kg === top).map((s) => s.reps).sort((a, b) => a - b);
  const mid = reps[Math.floor(reps.length / 2)];
  return mid >= range.rep_min - 2 && mid <= range.rep_max + 2;
}

/** The distinct rep ranges an exercise is programmed in across templates (overlapping ranges merge). */
export function planVariants(exerciseId: string, templates: Template[]): Plan[] {
  const out: Plan[] = [];
  for (const t of templates) {
    for (const te of t.exercises) {
      if (te.exercise_id !== exerciseId || out.some((p) => rangesOverlap(p, te))) continue;
      out.push({ sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg });
    }
  }
  return out.sort((a, b) => a.rep_min - b.rep_min);
}

/** For comparing a finished workout: each exercise against its last session in the same rep range. */
export function rangePicker(w: Workout, workouts: Workout[], templates: Template[]) {
  const tpl = w.template_id ? templates.find((t) => t.id === w.template_id) : undefined;
  return (exerciseId: string) => {
    const te = tpl?.exercises.find((e) => e.exercise_id === exerciseId);
    if (te) return previousInRange(exerciseId, te, workouts, templates, w.started_at, w.id);
    const mine = w.sets.filter((s) => s.exercise_id === exerciseId && isWorking(s) && s.reps > 0);
    if (!mine.length) return previousInRange(exerciseId, null, workouts, templates, w.started_at, w.id);
    const top = Math.max(...mine.map((s) => s.weight_kg));
    const r = mine.filter((s) => s.weight_kg === top).map((s) => s.reps).sort((a, b) => a - b)[Math.floor(mine.filter((s) => s.weight_kg === top).length / 2)];
    return previousInRange(exerciseId, { rep_min: r, rep_max: r }, workouts, templates, w.started_at, w.id);
  };
}

/** The last session of an exercise in this rep range (all its sets, warm-ups included), for the "Previous" column. */
export function previousInRange(exerciseId: string, range: RepRange | null, workouts: Workout[], templates: Template[], before: string, excludeId?: string): { workout: Workout; sets: WSet[] } | null {
  for (const w of workouts) {
    if (w.id === excludeId || w.started_at >= before) continue;
    const all = w.sets.filter((s) => s.exercise_id === exerciseId).sort((a, b) => a.set_number - b.set_number);
    if (!all.length) continue;
    const work = all.filter((s) => isWorking(s) && s.reps > 0);
    if (range && work.length && !inRange(w, work, exerciseId, range, templates)) continue;
    return { workout: w, sets: all };
  }
  return null;
}

/** Find a plan for an exercise: the template's, else one inferred from the last session. */
export function planFor(exerciseId: string, templates: Template[], hist: LiftHistory, fromTemplate?: Plan | null): Plan | null {
  if (fromTemplate) return fromTemplate;
  for (const t of templates) {
    const te = t.exercises.find((e) => e.exercise_id === exerciseId);
    if (te) return { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg };
  }
  const last = hist.sessions[0];
  if (!last) return null;
  const lo = Math.min(...last.topReps);
  return { sets: last.sets.length, rep_min: lo, rep_max: lo + 2, target_rpe: null };
}

/** +1 rep on the weakest set (the first of the lowest, so earlier sets fill up first). Capped at the top of the range. */
export function addOneRep(reps: number[], max: number): number[] {
  const r = reps.map((x) => Math.min(x, max));
  if (r.every((x) => x >= max)) return r;
  const idx = r.indexOf(Math.min(...r));
  r[idx] = Math.min(max, r[idx] + 1);
  return r;
}

function fit(reps: number[], n: number, fill: number): number[] {
  if (reps.length >= n) return reps.slice(0, n);
  return [...reps, ...Array.from({ length: n - reps.length }, () => fill)];
}

/** Reps you should manage at `kg` stopping at `rpe`, from an e1RM. */
function predictReps(oneRm: number, kg: number, rpe: number, formula: E1rmFormula): number {
  for (let r = 20; r >= 1; r--) {
    const p = pctOf1rm(r, rirFromRpe(rpe), formula);
    if (p && oneRm * p >= kg) return r;
  }
  return 1;
}

/** A drop of `pct` rounded to the nearest jump. If even one jump is more than 15% (light dumbbells), returns null. */
function dropBy(top: number, pct: number, inc: number): number | null {
  const kg = roundTo(top * (1 - pct), inc, "nearest");
  if (kg < top) return kg;
  return (top - inc) / top >= 0.85 ? top - inc : null;
}

const repsText = (reps: number[]) => (reps.length === 1 ? `${reps[0]} (1 set)` : reps.every((r) => r === reps[0]) ? `${reps.length} × ${reps[0]}` : reps.join(", "));
/** "70.5 kg × 11, then 68 kg × 11, 11, 10" */
const groupedText = (weights: number[], reps: number[]) => {
  const g: { w: number; r: number[] }[] = [];
  weights.forEach((w, i) => { if (g.length && g[g.length - 1].w === w) g[g.length - 1].r.push(reps[i]); else g.push({ w, r: [reps[i]] }); });
  return g.map((x) => `${fmtKg(x.w)} kg × ${x.r.join(", ")}`).join(", then ");
};
const setText = (s: WSet) => `${fmtKg(s.weight_kg)} × ${s.reps}${s.rpe != null ? ` @${s.rpe}` : ""}`;

export function coachExercise(
  exercise: Exercise | undefined,
  exerciseId: string,
  templatePlan: Plan | null,
  workouts: Workout[],
  templates: Template[],
  before: string,
  opts: CoachOpts,
): Prescription | null {
  const { formula, adj, deload, excludeId } = opts;
  const phase = opts.phase ?? null;
  // How far over target RPE still counts as "owned": a surplus recovers better, so it's more permissive
  const rpeBand = phase === "surplus" ? 1 : 0.5;
  const all = liftHistory(exerciseId, workouts, before, formula, excludeId);
  const found = planFor(exerciseId, templates, all, templatePlan);
  if (!found) return null;
  const plan = normalise(found);
  // Progress from sessions in this rep range only (bench 3–5 doesn't reset bench 8–10's progression)
  const hist = liftHistory(exerciseId, workouts, before, formula, excludeId, (w, sets) => inRange(w, sets, exerciseId, plan, templates));
  const otherRanges = all.sessions.length > hist.sessions.length;
  const inc = plan.increment_kg ?? incrementFor(exercise, opts.inc);
  const target = plan.target_rpe;
  // A session cut for readiness doesn't reset progress: plan from your last full session (within 3 weeks),
  // or scale the cut weight back up if there's none. Lifting full weight anyway counts as a normal session.
  let last = hist.sessions[0];
  let bounce = "";
  let scaledUp = false;
  if (last && last.factor < 1) {
    const cut = last;
    const full = hist.sessions.find((s) => s.factor >= 1);
    const recent = full && new Date(before).getTime() - new Date(full.at).getTime() <= 21 * DAY;
    if (full && recent && cut.top < full.top) {
      last = full;
      const n = hist.sessions.indexOf(full);
      bounce = ` Back to ${fmtKg(full.top)} kg: your last ${n === 1 ? "session was" : `${n} sessions were`} cut for readiness (${fmtKg(cut.top)} kg), so this carries on from your last full one.`;
    } else if (!full || !recent) {
      const up = roundTo(cut.top / cut.factor, plan.increment_kg ?? incrementFor(exercise, opts.inc), "nearest");
      if (up > cut.top) {
        last = { ...cut, top: up, sets: cut.sets.map((s) => (s.weight_kg === cut.top ? { ...s, weight_kg: up } : s)) };
        bounce = ` Scaled back up from ${fmtKg(cut.top)} kg (cut for readiness) to ${fmtKg(up)} kg.`;
        scaledUp = true;
      }
    }
  }
  const lowRun = (opts.lowRun ?? 0) >= LOW_RUN;
  let sets = adjustedSets(plan.sets, adj);
  let rpe = adjustedRpe(target, adj);
  let status: CoachStatus;
  let weight: number | null = null;
  let reps: number[];
  let weights: number[] | undefined;
  let why: string;

  // A last session logged under a different rep range (e.g. an 8–10 day feeding a new 10–12 template) seeds
  // the weight but isn't judged against this range's targets
  const lastTe = last ? templates.find((t) => t.id === workouts.find((w) => w.id === last.workoutId)?.template_id)?.exercises.find((e) => e.exercise_id === exerciseId) : undefined;
  const sameRange = !lastTe || (lastTe.rep_min === plan.rep_min && lastTe.rep_max === plan.rep_max);
  const comparable = last && sameRange && last.topReps.every((r) => r >= plan.rep_min - 2 && r <= plan.rep_max + 2);
  const recentE1rm = trainingE1rm(exerciseId, workouts, before, formula, excludeId);

  if (deload) {
    status = "deload";
    sets = Math.max(1, Math.ceil(plan.sets / 2));
    rpe = 7;
    weight = last ? roundTo(last.top * 0.9, inc, "down") : null;
    reps = Array(sets).fill(plan.rep_min);
    why = "Deload week: lighter and fewer sets so fatigue drops and strength shows through next week. Stop every set at RPE 7.";
  } else if (adj?.band === "very_low") {
    status = "recover";
    weight = last ? roundTo(last.top * 0.85, inc, "down") : null;
    reps = Array(sets).fill(plan.rep_min);
    why = "Readiness is very low, so today is about moving well, not progressing. Short and easy, or swap for cardio or rest.";
  } else if (!last || !comparable) {
    status = "new";
    // Seed from estimated 1RM so a new range starts from real strength. Use the recent session (8 weeks)
    // closest in reps: estimates from heavy triples run higher than from sets of 10, so like predicts like.
    const seedRpe = target ?? (otherRanges ? 8 : null);
    const cut = new Date(before).getTime() - 56 * DAY;
    const near = all.sessions
      .filter((x) => x.e1rm != null && new Date(x.at).getTime() >= cut)
      .map((x) => ({ x, d: Math.abs([...x.topReps].sort((p, q) => p - q)[Math.floor(x.topReps.length / 2)] - plan.rep_min) }))
      .sort((p, q) => p.d - q.d)[0]?.x;
    const seedE1rm = near?.e1rm ?? recentE1rm;
    const l = seedE1rm && seedRpe ? loadFor(seedE1rm, plan.rep_min, seedRpe, formula) : null;
    weight = l ? roundTo(l, inc, "down") : last ? last.top : null;
    reps = Array(sets).fill(plan.rep_min);
    why = weight
      ? `First session at ${rangeLabel(plan)}. ${fmtKg(weight)} kg should give ${plan.rep_min} reps${seedRpe ? ` at RPE ${seedRpe}` : ""}${seedE1rm ? `, from your estimated 1RM of ${fmtKg(Math.round(seedE1rm))} kg${otherRanges && near ? ` (your ${fmtKg(near.top)} kg × ${near.topReps.join(", ")} session)` : ""}` : ""}. Adjust the first set if it's off, and the coach tracks this range on its own from here.`
      : `Pick a weight you can lift for ${plan.rep_min}–${plan.rep_max} reps${target ? ` at about RPE ${target}` : ""}. The coach takes over from your first session.`;
  } else {
    const atTopSets = last.sets.filter((s) => s.weight_kg === last.top);
    const missed = last.topReps.filter((r) => r < plan.rep_min).length;
    const maxRpe = Math.max(0, ...atTopSets.map((s) => s.rpe ?? 0));
    // Target RPE is read as the average across working sets: later sets naturally run higher at a fixed weight.
    const rated = atTopSets.filter((s) => s.rpe != null).map((s) => s.rpe as number);
    const avgRpe = rated.length ? sum(rated) / rated.length : null;
    const rpeOk = target == null || avgRpe == null || avgRpe <= target + rpeBand;
    const allTop = last.topReps.every((r) => r >= plan.rep_max);
    const lastReps = fit(last.topReps, sets, Math.min(...last.topReps));
    const holdForReadiness = adj != null && !adj.allowProgression;

    const below = Math.abs(Math.round(hist.vsPeakPct ?? 0));
    const preserveMode = plan.on_stall === "preserve";
    // "High" = above the band where progression is allowed
    const highRpe = avgRpe != null && (target != null ? avgRpe > target + rpeBand : avgRpe >= 9);
    // Going backwards: slipping vs the 6-week peak, or two session-to-session drops in a row
    const e = hist.sessions.slice(0, 3).map((s) => s.e1rm);
    const twoDrops = e.length === 3 && e.every((v) => v != null) && (e[0] as number) < (e[1] as number) * 0.98 && (e[1] as number) < (e[2] as number) * 0.98;
    const backwards = hist.slipping || twoDrops;
    const stuckHard = hist.stalled >= 2 && highRpe;

    if (preserveMode && phase === "surplus" && !backwards && (stuckHard || missed >= 2)) {
      // In a surplus you can recover from more work, so a stall is answered with volume, not a hold
      status = "add_set";
      const oneDown = last.top - inc;
      const canDrop = missed >= 2 && oneDown > 0 && oneDown / last.top >= 0.85;
      weight = canDrop ? oneDown : last.top;
      sets = Math.min(Math.max(plan.sets + 1, sets), 6);
      reps = canDrop ? Array(sets).fill(plan.rep_min) : fit(last.topReps, sets, Math.min(...last.topReps)).map((r) => Math.min(r, plan.rep_max));
      why = `${missed >= 2 ? `Reps fell below ${plan.rep_min} on ${missed} sets` : `No progress for ${hist.stalled} sessions at RPE ${Math.round(avgRpe! * 10) / 10}`}. You're in a surplus, so add a set${canDrop ? ` and take one jump off to ${fmtKg(weight)} kg` : ` at ${fmtKg(weight)} kg`}: the extra volume drives the next gain. Stop at RPE ${rpe ?? 8}.`;
    } else if (preserveMode && (backwards || stuckHard || missed >= 2)) {
      status = "protect";
      const trim = (backwards || highRpe) && !lowRun;
      if (trim) sets = Math.max(Math.min(sets, 2), sets - 1);
      if (target != null) rpe = Math.min(rpe ?? target, target);
      const oneDown = last.top - inc;
      const canDrop = missed >= 2 && oneDown > 0 && oneDown / last.top >= 0.85;
      weight = canDrop ? oneDown : last.top;
      reps = canDrop ? Array(sets).fill(plan.rep_min) : fit(last.topReps, sets, Math.min(...last.topReps)).map((r) => Math.min(r, plan.rep_max));
      const reasons: string[] = [];
      if (hist.slipping) reasons.push(`estimated 1RM is ${below}% under its 6-week best`);
      else if (twoDrops) reasons.push("estimated 1RM has dropped two sessions running");
      if (stuckHard) reasons.push(`no progress for ${hist.stalled} sessions with RPE averaging ${Math.round(avgRpe! * 10) / 10}${target != null ? ` against a target of ${target}` : ""}`);
      if (missed >= 2) reasons.push(`reps fell below ${plan.rep_min} on ${missed} sets`);
      const r0 = reasons.join(", and ");
      why = lowRun && !canDrop
        ? `${r0.charAt(0).toUpperCase()}${r0.slice(1)}, while readiness has been under 60 on ${opts.lowRun} of the last 7 days. That points to fatigue, not lost strength. Keep ${fmtKg(last.top)} kg and last time's reps on every set, stop at RPE ${rpe ?? 8}, and put the effort into recovery: sleep${phase === "deficit" ? ", and ask your coach about a diet break or a deload if it lasts" : " and a deload if it lasts"}.`
        : `${r0.charAt(0).toUpperCase()}${r0.slice(1)}. Goal now: preserve muscle. `
        + (canDrop
          ? `Take one jump off to ${fmtKg(weight)} kg so every set lands back in the ${plan.rep_min}–${plan.rep_max} range, and keep it heavy.`
          : `Keep ${fmtKg(last.top)} kg on the bar: heavy loading is the signal that holds muscle${phase === "deficit" ? " in a deficit" : ""}. Match last time's reps rather than grinding for more.`)
        + `${trim ? " One fewer set keeps fatigue down." : ""} Stop at RPE ${rpe ?? 8}. Progression resumes once reps climb or RPE drops; if it keeps sliding, take a deload week.`;
      if (lowRun && !canDrop) why = why.split(" Goal now")[0];
    } else if (hist.slipping && lowRun) {
      status = "protect";
      if (target != null) rpe = Math.min(rpe ?? target, target);
      weight = last.top;
      reps = fit(last.topReps, sets, Math.min(...last.topReps)).map((r) => Math.min(r, plan.rep_max));
      why = `Estimated 1RM is ${below}% under its 6-week best, while readiness has been under 60 on ${opts.lowRun} of the last 7 days. That points to fatigue, not lost strength. Keep ${fmtKg(last.top)} kg and last time's reps on every set, stop at RPE ${rpe ?? 8}, and put the effort into recovery: sleep${phase === "deficit" ? ", and ask your coach about a diet break or a deload if it lasts" : " and a deload if it lasts"}.`;
    } else if (hist.slipping) {
      status = "protect";
      sets = Math.max(Math.min(sets, 2), sets - 1);
      if (target != null) rpe = Math.min(rpe ?? target, target);
      const dropped = missed >= 2 ? dropBy(last.top, 0.05, inc) : null;
      if (dropped != null) {
        weight = dropped;
        reps = Array(sets).fill(plan.rep_min);
        why = `Estimated 1RM is ${below}% under its 6-week best on 2 of the last 3 sessions, and reps fell below ${plan.rep_min}. Drop to ${fmtKg(weight)} kg so every set lands in range, do one fewer set to shed fatigue, and stop at RPE ${rpe ?? 8}. If it keeps dropping, take a deload week.`;
      } else {
        weight = last.top;
        reps = fit(last.topReps, sets, Math.min(...last.topReps)).map((r) => Math.min(r, plan.rep_max));
        why = `Estimated 1RM is ${below}% under its 6-week best on 2 of the last 3 sessions. Keep ${fmtKg(last.top)} kg (holding the weight is what holds strength in a deficit), match last time's reps with one fewer set to shed fatigue, and stop at RPE ${rpe ?? 8}. If it keeps dropping, take a deload week.`;
      }
    } else if (!preserveMode && (missed >= 2 || hist.stalled >= 3)) {
      status = "reset";
      const stalledCase = missed < 2;
      const dropped = dropBy(last.top, stalledCase ? 0.075 : 0.05, inc);
      if (dropped != null) {
        weight = dropped;
        reps = Array(sets).fill(stalledCase ? plan.rep_max : Math.min(plan.rep_max, plan.rep_min + 1));
        why = stalledCase
          ? `No gain in reps or weight for ${hist.stalled} sessions at ${fmtKg(last.top)} kg. Drop to ${fmtKg(weight)} kg, hit the top of the range, then build back. Resets like this usually beat the old best within 3–4 weeks.`
          : `You fell short of ${plan.rep_min} reps on ${missed} sets last time (${last.topReps.join(", ")}). Drop to ${fmtKg(weight)} kg and rebuild; you'll be back above ${fmtKg(last.top)} kg within a few sessions.`;
      } else {
        // The weight jump is too big to reset by (light dumbbells): progress volume instead
        status = "add_set";
        weight = last.top;
        sets = Math.min(5, sets + 1);
        reps = fit(last.topReps, sets, Math.min(...last.topReps));
        why = `${stalledCase ? `No gain for ${hist.stalled} sessions` : `Reps fell short`} at ${fmtKg(last.top)} kg, but one weight jump here is over 15%. Add a set at the same weight instead; once reps climb, you'll be ready for the next weight.`;
      }
    } else if (new Set(last.sets.map((x) => x.weight_kg)).size > 1) {
      // Weights varied last time (a top set, then back-off sets): progress each set from its own weight, reps and
      // RPE, rather than putting the top weight on every set. At or under target RPE: one more rep (two if it was
      // a full point easier). Over target: repeat it. At the top of the range: that set goes up a jump.
      status = "build_reps";
      const band = target != null ? target + rpeBand : null;
      const prevSets = Array.from({ length: sets }, (_, i) => last.sets[i] ?? null);
      const lastDone = last.sets[last.sets.length - 1];
      const ws: number[] = [], rs: number[] = [];
      let up = 0, held = 0, added = 0;
      prevSets.forEach((x, i) => {
        if (!x) { ws.push(ws[i - 1] ?? lastDone.weight_kg); rs.push(Math.min(plan.rep_max, lastDone.reps)); return; } // a set you didn't do last time: match your last one
        if (holdForReadiness || (band != null && x.rpe != null && x.rpe > band)) { ws.push(x.weight_kg); rs.push(x.reps); held++; return; }
        if (x.reps >= plan.rep_max) { ws.push(x.weight_kg + inc); rs.push(plan.rep_min); up++; return; }
        const step = target != null && x.rpe != null && x.rpe <= target - 1 ? 2 : 1;
        const r = Math.min(plan.rep_max, x.reps + step);
        added += r - x.reps;
        ws.push(x.weight_kg); rs.push(r);
      });
      weights = ws;
      reps = rs;
      weight = ws[0];
      if (up > 0 && added === 0 && held === 0) status = "add_weight";
      const parts: string[] = [];
      if (added) parts.push(`${added} more rep${added === 1 ? "" : "s"} on the sets you kept at${target != null ? ` or under RPE ${band}` : " a manageable effort"}`);
      if (up) parts.push(`${up === 1 ? "one set moves" : `${up} sets move`} up ${fmtKg(inc)} kg after hitting ${plan.rep_max}`);
      if (held) parts.push(holdForReadiness ? "the same as last time while readiness is down" : `${held === 1 ? "one set repeats" : `${held} sets repeat`} because ${held === 1 ? "it was" : "they were"} over RPE ${band}`);
      why = `Set by set from last time (${last.sets.map(setText).join(", ")}): ${parts.join("; ") || "repeat each set"}.${prevSets.some((x) => !x) ? " A set you didn't do last time matches your last one." : ""} Once a set reaches ${plan.rep_max} at target RPE, its weight goes up.`;
    } else if (allTop && rpeOk) {
      const easy = target != null && avgRpe != null && avgRpe <= target - 1.5;
      const beyond = Math.min(...last.topReps) - plan.rep_max; // reps past the top of the range on the weakest set
      const barbell = exercise?.equipment === "barbell";
      const lowerBarbell = barbell && exercise && LOWER.has(exercise.muscle);
      let jump = easy && (lowerBarbell || (phase === "surplus" && barbell)) ? inc * 2 : inc;
      // Beat the range or found it easy: size the jump from what you actually did (capped at 3 jumps / 7.5%)
      let beat = "";
      if ((beyond >= 1 || easy) && last.e1rm && target) {
        const fromE1rm = loadFor(last.e1rm, plan.rep_min, target, formula);
        const cap = Math.max(inc, Math.min(inc * 3, roundTo(last.top * 0.075, inc, "down")));
        if (fromE1rm) jump = Math.max(jump, Math.min(cap, roundTo(fromE1rm - last.top, inc, "down")));
        beat = beyond >= 1 ? ` You went past the top of the range${jump > inc ? ", so the jump is bigger" : ""}.` : jump > inc ? " It was comfortably under target RPE, so the jump is bigger." : "";
      }
      if (holdForReadiness) {
        status = "readiness_hold";
        weight = last.top;
        reps = lastReps;
        why = `You've earned +${fmtKg(jump)} kg, but readiness is down today. Repeat last time; the increase waits for a better day.`;
      } else {
        status = "add_weight";
        weight = last.top + jump;
        const ref = recentE1rm ?? last.e1rm;
        const predicted = ref && target ? predictReps(ref, weight, target, formula) : plan.rep_min;
        const goal = Math.max(plan.rep_min, Math.min(plan.rep_max - 1, predicted));
        reps = Array(sets).fill(goal);
        why = `${beyond > 0 ? `${Math.min(...last.topReps)}+` : plan.rep_max} reps on every set at ${fmtKg(last.top)} kg${avgRpe != null ? ` (average RPE ${Math.round(avgRpe * 10) / 10})` : ""}. Up ${fmtKg(jump)} kg to ${fmtKg(weight)} kg and aim for ${goal} on every set${plan.progression === "fixed" ? "" : `, then build back to ${plan.rep_max}`}.${beat}`;
      }
    } else if (target != null && avgRpe != null && (avgRpe > target + 1 || (allTop && !rpeOk))) {
      status = "consolidate";
      weight = last.top;
      reps = lastReps;
      why = allTop
        ? `Every set hit ${plan.rep_max}, but averaging RPE ${Math.round(avgRpe * 10) / 10} against a target of ${target}. Repeat ${fmtKg(last.top)} kg × ${last.topReps.join(", ")} until it averages RPE ${target + rpeBand} or easier, then the weight goes up.`
        : `Last time averaged RPE ${Math.round(avgRpe * 10) / 10} (up to ${maxRpe}), above your target of ${target}. Repeat ${fmtKg(last.top)} kg × ${last.topReps.join(", ")} and stop at RPE ${target}. Owning the weight comes before adding reps.`;
    } else if (holdForReadiness) {
      status = "readiness_hold";
      weight = last.top;
      reps = lastReps;
      why = "Readiness is down, so repeat last time rather than chase a rep. Matching it on a rough day still counts.";
    } else {
      status = "build_reps";
      weight = last.top;
      // Momentum: easy last time, or you beat the session before by 2+ reps at this weight → aim for 2 more
      const prevSame = hist.sessions[1] && hist.sessions[1].top === last.top ? sum(hist.sessions[1].topReps) : null;
      const surge = prevSame != null && sum(last.topReps) - prevSame >= 2;
      const easyRpe = target != null && avgRpe != null && avgRpe <= target - 1;
      reps = addOneRep(lastReps, plan.rep_max);
      if (surge || easyRpe) reps = addOneRep(reps, plan.rep_max);
      const added = sum(reps) - sum(lastReps);
      why = `Same weight, ${added >= 2 ? `${added} more reps than` : added === 1 ? "one more rep than" : "the same reps as"} last time (${last.topReps.join(", ")})${added >= 2 ? (surge ? `, since you added ${sum(last.topReps) - prevSame!} reps last session` : ", since it felt easy last time") : ""}. Once every set reaches ${plan.rep_max}, the weight goes up.`;
    }
  }

  // A weight scaled back up from a cut day hasn't been lifted yet: repeat it before adding more
  if (scaledUp && last && status === "add_weight" && !weights) {
    status = "build_reps";
    weight = last.top;
    reps = fit(last.topReps, sets, Math.min(...last.topReps)).map((r) => Math.min(r, plan.rep_max));
    why = `Your last session was cut for readiness and there's no full session in the last 3 weeks, so this scales it back up to ${fmtKg(last.top)} kg. Match those reps here first; the weight goes up once you've owned it.`;
    bounce = "";
  }
  if (bounce && status !== "deload" && status !== "recover" && status !== "new") why += bounce;

  // Readiness load scaling (never up); deload/recover/new already set their own loads
  if (adj && adj.loadFactor < 1 && weight != null && status !== "deload" && status !== "recover") {
    const scaled = roundTo(weight * adj.loadFactor, inc, "nearest");
    if (scaled < weight) {
      why += ` Readiness: ${fmtKg(weight)} → ${fmtKg(scaled)} kg today${weights ? " (the other sets scale the same)" : ""}.`;
      weight = scaled;
      if (weights) weights = weights.map((w) => roundTo(w * adj.loadFactor, inc, "nearest"));
    } else {
      why += " Readiness is down; the weight jump is too big to trim, so keep it and stop a rep earlier.";
    }
  }

  const headline = weights && new Set(weights).size > 1
    ? `${groupedText(weights, reps)}${rpe != null ? ` @ RPE ${rpe}` : ""}`
    : `${weight != null ? `${fmtKg(weight)} kg × ` : ""}${repsText(reps)}${rpe != null ? ` @ RPE ${rpe}` : ""}`;
  return { exerciseId, status, weight, ...(weights ? { weights } : {}), reps, rpe, sets: reps.length, headline, why, history: hist, plan };
}

export interface CoachOverview {
  lifts: Prescription[];
  slipping: Prescription[];
  deloadAdvised: boolean;
  deloadReason: string | null;
}

/** Every lift trained in the last 6 weeks, plus a deload recommendation. */
export function coachOverview(exercises: Exercise[], workouts: Workout[], templates: Template[], opts: Omit<CoachOpts, "adj"> & { adj: Adjustment | null; readiness7: number | null }): CoachOverview {
  const now = new Date(Date.now() + 1000).toISOString();
  const cutoff = Date.now() - 42 * DAY;
  const seen = new Set<string>();
  for (const w of workouts) {
    if (new Date(w.started_at).getTime() < cutoff) continue;
    for (const s of w.sets) seen.add(s.exercise_id);
  }
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const lifts = [...seen]
    .flatMap((id) => {
      const variants = planVariants(id, templates);
      const ps = (variants.length ? variants : [null]).map((v) => coachExercise(exMap.get(id), id, v, workouts, templates, now, opts));
      // Skip a range with no sessions in the last 6 weeks when the lift has other ranges that do
      const live = ps.filter((p): p is Prescription => p != null && (ps.length === 1 || p.history.sessions.some((s) => new Date(s.at).getTime() >= cutoff)));
      return live;
    });
  const slipping = lifts.filter((p) => p.history.slipping);
  const slippingLifts = new Set(slipping.map((p) => p.exerciseId)).size;
  let deloadReason: string | null = null;
  if (!opts.deload) {
    if (slippingLifts >= 2) deloadReason = `${slippingLifts} lifts are below their 6-week best.`;
    else if (slipping.length === 1 && opts.readiness7 != null && opts.readiness7 < 60) deloadReason = "A lift is slipping and your readiness has averaged under 60 this week.";
    else if (slipping.length >= 1 && (opts.lowRun ?? 0) >= LOW_RUN) deloadReason = `A lift is slipping and readiness has been under 60 on ${opts.lowRun} of the last 7 days: fatigue is building.`;
  }
  return { lifts, slipping, deloadAdvised: deloadReason != null, deloadReason };
}

export function deloadActive(until: string | null): boolean {
  if (!until) return false;
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return d <= until;
}

/** How a finished session went against the coach's prescription for it. */
export function verdict(p: Prescription, done: WSet[]): { hit: boolean; text: string } {
  const work = done.filter((s) => isWorking(s) && s.reps > 0);
  if (!work.length || p.weight == null) return { hit: false, text: "" };
  if (p.weights && new Set(p.weights).size > 1) {
    // Set by set: each set against its own weight and rep goal
    const goal = sum(p.reps);
    const got = p.reps.reduce((a, r, i) => a + (work[i] ? (work[i].weight_kg >= p.weights![i] ? Math.min(work[i].reps, 99) : 0) : 0), 0);
    const hitAll = p.reps.every((r, i) => work[i] && work[i].weight_kg >= p.weights![i] && work[i].reps >= r);
    return hitAll ? { hit: true, text: got > goal ? `Target beaten: ${got} reps vs ${goal}. The next session builds from each set.` : "Target hit on every set." } : { hit: false, text: `${got} of ${goal} target reps at the prescribed weights.` };
  }
  const top = Math.max(...work.map((s) => s.weight_kg));
  const atTop = work.filter((s) => s.weight_kg === top);
  if (top < p.weight) return { hit: false, text: `Lighter than the ${fmtKg(p.weight)} kg prescribed.` };
  const hitAll = p.reps.every((goal, i) => (atTop[i]?.reps ?? 0) >= goal);
  const totalGoal = sum(p.reps);
  const total = sum(atTop.slice(0, p.reps.length).map((s) => s.reps));
  if (top > p.weight) return { hit: true, text: `Heavier than prescribed (${fmtKg(top)} kg vs ${fmtKg(p.weight)} kg), so the next session builds from ${fmtKg(top)} kg.` };
  if (hitAll) return { hit: true, text: total > totalGoal ? `Target beaten: ${total} reps vs ${totalGoal}. The next session is raised to match.` : "Target hit." };
  return { hit: false, text: `${total} of ${totalGoal} target reps.` };
}
