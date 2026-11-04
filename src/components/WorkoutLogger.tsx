import { useEffect, useMemo, useState } from "react";
import type { AppData } from "../App";
import type { SetType, Template, WSet, Workout } from "../lib/strength";
import {
  MUSCLE_LABEL, SET_TYPE_LABEL, SET_TYPE_SHORT, bestE1rm, bestE1rmBefore, fmtKg, fmtTonnage, isConditioning,
  pctChange, previousFor, volume, warmupRamp,
} from "../lib/strength";
import { toLocalInput } from "../lib/dates";
import { unlockAudio } from "../lib/restAlert";
import { useBackHandler } from "../lib/backNav";
import { advance, programStepFor, setNextStep } from "../lib/programs";
import type { Adjustment, Checkin } from "../lib/readiness";
import { BAND_LABEL, adjustmentFor, latestPhase, lowReadinessCount } from "../lib/readiness";
import type { Prescription } from "../lib/coach";
import { STATUS_LABEL, STATUS_TONE, coachExercise, deloadActive, previousInRange } from "../lib/coach";
import { deleteWorkout, saveWorkout } from "../lib/strengthData";
import ExercisePicker from "./ExercisePicker";

interface Plan {
  sets: number; rep_min: number; rep_max: number; target_rpe: number | null; rest_sec: number | null; notes: string | null;
  progression?: "rep_range" | "fixed"; on_stall?: "preserve" | "reset"; increment_kg?: number | null;
}
const planOf = (te: Template["exercises"][number]): Plan => ({
  sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, rest_sec: te.rest_sec, notes: te.notes,
  progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg,
});
interface LSet { key: string; set_type: SetType; weight: string; reps: string; rpe: string; done: boolean }
interface LExercise { key: string; exercise_id: string; plan: Plan | null; sets: LSet[] }
interface Draft {
  id?: string;
  template_id: string | null;
  name: string;
  started_at: string; // ISO
  duration: string; // minutes, edit mode only
  notes: string;
  exercises: LExercise[];
  restEnd: number | null;
  restTotal: number;
  // Readiness scan applied to this workout
  checkin_id?: string | null;
  // Set when this workout is the active program's next step; finishing it advances the rotation
  program_id?: string | null;
  program_step?: number | null;
  checkinScore?: number | null;
  checkinSoreness?: number | null;
  useAdj?: boolean;
  /** Conditioning: rounds of every exercise back to back, then `rest` seconds; ticked off a round at a time */
  circuit?: { rounds: number; rest: number } | null;
}

const DRAFT_KEY = "cardio-log:workout-draft";
const uid = () => Math.random().toString(36).slice(2, 10);

export function hasWorkoutDraft(): boolean {
  try { return Boolean(localStorage.getItem(DRAFT_KEY)); } catch { return false; }
}
export function readWorkoutDraft(): Draft | null {
  try { const r = localStorage.getItem(DRAFT_KEY); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
}
/** Change the saved in-progress workout from outside the logger (e.g. rest changed on the notification). */
export const REST_SYNC_EVENT = "trainingLog:restSync";
export function patchRestFromPhone(endAt: number | null, addedMs: number) {
  const d = readWorkoutDraft();
  if (!d) return;
  const restEnd = endAt && endAt > Date.now() ? endAt : null;
  writeDraft({ ...d, restEnd, restTotal: restEnd ? d.restTotal + Math.max(0, Math.round(addedMs / 1000)) : d.restTotal });
  window.dispatchEvent(new CustomEvent(REST_SYNC_EVENT, { detail: { restEnd, addedMs } }));
}
function writeDraft(d: Draft | null) {
  try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch { /* no storage */ }
}

function parse(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const emptySet = (type: SetType = "working"): LSet => ({ key: uid(), set_type: type, weight: "", reps: "", rpe: "", done: false });

function fromTemplate(t: Template | null, checkin: Checkin | null, setsFor: (te: Template["exercises"][number]) => number): Draft {
  const circuit = t && isConditioning(t) ? { rounds: t.rounds ?? Math.max(1, ...t.exercises.map((e) => e.sets)), rest: t.round_rest_sec ?? 90 } : null;
  return {
    circuit,
    checkin_id: checkin?.id ?? null,
    checkinScore: checkin?.score ?? null,
    checkinSoreness: checkin?.soreness ?? null,
    useAdj: Boolean(checkin),
    template_id: t?.id ?? null,
    name: t?.name ?? "Workout",
    started_at: new Date().toISOString(),
    duration: "",
    notes: "",
    exercises: (t?.exercises ?? []).map((te) => ({
      key: uid(),
      exercise_id: te.exercise_id,
      plan: planOf(te),
      sets: Array.from({ length: circuit ? circuit.rounds : setsFor(te) }, () => emptySet()),
    })),
    restEnd: null,
    restTotal: 0,
  };
}

function fromWorkout(w: Workout, templates: Template[]): Draft {
  const groups = new Map<number, WSet[]>();
  for (const s of w.sets) {
    if (!groups.has(s.exercise_position)) groups.set(s.exercise_position, []);
    groups.get(s.exercise_position)!.push(s);
  }
  const t = templates.find((x) => x.id === w.template_id);
  return {
    id: w.id,
    template_id: w.template_id,
    checkin_id: w.checkin_id,
    program_id: w.program_id ?? null,
    program_step: w.program_step ?? null,
    name: w.name,
    started_at: w.started_at,
    duration: w.duration_min != null ? String(w.duration_min) : "",
    notes: w.notes ?? "",
    exercises: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, sets]) => {
      const te = t?.exercises.find((x) => x.exercise_id === sets[0].exercise_id);
      return {
        key: uid(),
        exercise_id: sets[0].exercise_id,
        plan: te ? planOf(te) : null,
        sets: sets.sort((a, b) => a.set_number - b.set_number).map((s) => ({
          key: uid(), set_type: s.set_type, weight: fmtKg(s.weight_kg), reps: String(s.reps), rpe: s.rpe != null ? String(s.rpe) : "", done: true,
        })),
      };
    }),
    restEnd: null,
    restTotal: 0,
  };
}

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
};
const fmtRest = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

interface Props {
  workout: Workout | null;
  template: Template | null;
  data: AppData;
  onClose: () => void;
  onSaved: (id: string, isNew: boolean) => void;
  onDeleted: () => void;
  onCreatedExercise: () => void;
  checkin: Checkin | null;
  onScan: () => void;
  onWarmup: (t: Template) => void;
}

export default function WorkoutLogger({ workout, template, data, onClose, onSaved, onDeleted, onCreatedExercise, checkin, onScan, onWarmup }: Props) {
  const { exercises, workouts, settings, templates } = data;
  const isEdit = Boolean(workout);
  const [draft, setDraft] = useState<Draft>(() => {
    if (workout) return fromWorkout(workout, templates);
    const saved = readWorkoutDraft();
    if (saved && !saved.id) return saved;
    // Sets per exercise come from the coach (readiness, protect and deload can trim them)
    const adj0 = checkin ? adjustmentFor(checkin) : null;
    const start = new Date().toISOString();
    const d = fromTemplate(template, checkin, (te) =>
      coachExercise(exercises.find((e) => e.id === te.exercise_id), te.exercise_id,
        planOf(te),
        workouts, templates, start, { formula: settings.e1rm_formula, inc: settings.weight_increment, adj: adj0, deload: deloadActive(settings.deload_until), phase: latestPhase(data.checkins), lowRun: lowReadinessCount(data.checkins) })?.sets ?? te.sets);
    const ps = programStepFor(template, data);
    return ps ? { ...d, program_id: ps.programId, program_step: ps.step } : d;
  });
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState<null | { replaceKey?: string }>(null);
  useBackHandler(picking != null, () => setPicking(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "finish" | "discard" | "delete">(null);
  const exMap = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const formula = settings.e1rm_formula;
  const inc = settings.weight_increment;

  useEffect(() => { if (!isEdit) writeDraft(draft); }, [draft, isEdit]);
  // A scan done after the workout started (e.g. from the banner) gets attached here.
  useEffect(() => {
    if (!isEdit && checkin && !draft.checkin_id) {
      setDraft((d) => ({ ...d, checkin_id: checkin.id, checkinScore: checkin.score, checkinSoreness: checkin.soreness, useAdj: true }));
    }
  }, [checkin, isEdit, draft.checkin_id]);

  const planAdj: Adjustment | null = draft.checkinScore != null ? adjustmentFor({ score: draft.checkinScore, soreness: draft.checkinSoreness ?? 3 }) : null;
  const adj: Adjustment | null = draft.useAdj && !isEdit ? planAdj : null;
  const deload = deloadActive(settings.deload_until);
  useEffect(() => {
    if (isEdit) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isEdit]);

  // −15 / +15 / Skip pressed on the phone's rest notification
  useEffect(() => {
    if (isEdit) return;
    const on = (e: Event) => {
      const { restEnd, addedMs } = (e as CustomEvent<{ restEnd: number | null; addedMs: number }>).detail;
      setDraft((d) => ({ ...d, restEnd, restTotal: restEnd ? d.restTotal + Math.max(0, Math.round(addedMs / 1000)) : d.restTotal }));
    };
    window.addEventListener(REST_SYNC_EVENT, on);
    return () => window.removeEventListener(REST_SYNC_EVENT, on);
  }, [isEdit]);

  // Rest timer: the beep, buzz and minimised push live in useRestAlerts (App level).
  const restLeft = draft.restEnd ? Math.ceil((draft.restEnd - now) / 1000) : null;
  useEffect(() => {
    if (restLeft != null && restLeft < -4) setDraft((d) => ({ ...d, restEnd: null }));
  }, [restLeft]);

  const update = (fn: (d: Draft) => Draft) => { setConfirm(null); setDraft(fn); };
  const updEx = (key: string, fn: (e: LExercise) => LExercise) => update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? fn(e) : e)) }));
  const updSet = (ek: string, sk: string, fn: (s: LSet) => LSet) => updEx(ek, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === sk ? fn(s) : s)) }));

  /** The coach's prescription for an exercise, with or without today's readiness. */
  function prescribe(ex: LExercise, withAdj: Adjustment | null = adj): Prescription | null {
    const plan = ex.plan ? { sets: ex.plan.sets, rep_min: ex.plan.rep_min, rep_max: ex.plan.rep_max, target_rpe: ex.plan.target_rpe, progression: ex.plan.progression, on_stall: ex.plan.on_stall, increment_kg: ex.plan.increment_kg } : null;
    return coachExercise(exMap.get(ex.exercise_id), ex.exercise_id, plan, workouts, templates, draft.started_at,
      { formula, inc, adj: withAdj, deload, excludeId: draft.id, phase: latestPhase(data.checkins), lowRun: lowReadinessCount(data.checkins) });
  }

  /** What to pre-fill: the coach's weight, per-set rep goals and RPE. */
  function suggestions(ex: LExercise) {
    // "Previous" = the last session in this rep range (bench 8–10 shows the last 8–10 day, not the heavy day)
    const prev = ex.plan ? previousInRange(ex.exercise_id, ex.plan, workouts, templates, draft.started_at, draft.id) : previousFor(ex.exercise_id, workouts, draft.started_at, draft.id);
    // Reference for the %1RM shown per set (same as the workout summary uses)
    const ref = bestE1rmBefore(ex.exercise_id, workouts, draft.started_at, formula, draft.id);
    const presc = isEdit ? null : prescribe(ex);
    return { prev, ref, presc, workingKg: presc?.weight ?? null, rpeToday: presc?.rpe ?? null };
  }

  function placeholderFor(ex: LExercise, idx: number, sug: ReturnType<typeof suggestions>) {
    const s = ex.sets[idx];
    const p = prevMatch(ex, idx, sug);
    const working = s.set_type !== "warmup";
    const wi = ex.sets.slice(0, idx).filter((x) => x.set_type !== "warmup").length; // working-set index
    const goals = sug.presc?.reps ?? [];
    const perSet = sug.presc?.weights;
    const wk = perSet ? perSet[wi] ?? perSet[perSet.length - 1] : sug.workingKg;
    const weight = working && wk != null ? fmtKg(wk) : p ? fmtKg(p.weight_kg) : "";
    const goal = working ? goals[wi] ?? goals[goals.length - 1] : undefined;
    const reps = goal != null ? String(goal) : p ? String(p.reps) : working && ex.plan ? String(ex.plan.rep_min) : "";
    const rpe = working && sug.rpeToday != null ? String(sug.rpeToday) : "";
    return { weight, reps, rpe };
  }

  /** Last time's set in the same position: warm-ups line up with warm-ups, working sets with working sets. */
  function prevMatch(ex: LExercise, idx: number, sug: ReturnType<typeof suggestions>): WSet | undefined {
    if (!sug.prev) return undefined;
    const warm = ex.sets[idx].set_type === "warmup";
    const ordinal = ex.sets.slice(0, idx).filter((x) => (x.set_type === "warmup") === warm).length;
    return sug.prev.sets.filter((x) => (x.set_type === "warmup") === warm)[ordinal];
  }

  function toggleDone(ex: LExercise, idx: number, sug: ReturnType<typeof suggestions>) {
    const s = ex.sets[idx];
    unlockAudio(); // a tap, so the end-of-rest beep is allowed to play
    if (!s.done) {
      const ph = placeholderFor(ex, idx, sug);
      const weight = s.weight || ph.weight || "0";
      const reps = s.reps || ph.reps;
      const rpe = s.rpe || ph.rpe;
      if (!reps) {
        setError("Enter the reps for that set first.");
        return;
      }
      setError(null);
      const planRest = ex.plan?.rest_sec ?? settings.default_rest_sec;
      // Warm-ups: ~1 min between them, up to 2 min after the last one before the first working set
      const nextIsWarmup = ex.sets[idx + 1]?.set_type === "warmup";
      const rest = s.set_type === "warmup" ? (nextIsWarmup ? Math.min(60, planRest) : Math.min(120, planRest)) : planRest;
      update((d) => ({
        ...d,
        restEnd: !isEdit && rest > 0 ? Date.now() + rest * 1000 : d.restEnd,
        restTotal: !isEdit && rest > 0 ? rest : d.restTotal,
        exercises: d.exercises.map((e) => e.key !== ex.key ? e : { ...e, sets: e.sets.map((x) => x.key !== s.key ? x : { ...x, weight, reps, rpe, done: true }) }),
      }));
    } else {
      updSet(ex.key, s.key, (x) => ({ ...x, done: false }));
    }
  }

  /** Prefill a warm-up ramp from the first working set's target: weight rises, reps fall, last one ~80–90%. */
  function addWarmups(ex: LExercise, sug: ReturnType<typeof suggestions>) {
    const info = exMap.get(ex.exercise_id);
    const firstWork = ex.sets.find((x) => x.set_type !== "warmup");
    const prevTop = sug.prev ? Math.max(0, ...sug.prev.sets.filter((x) => x.set_type !== "warmup").map((x) => x.weight_kg)) : 0;
    const typed = firstWork ? parse(firstWork.weight) : null;
    const working = (typed != null && !Number.isNaN(typed) && typed > 0 ? typed : null) ?? sug.workingKg ?? (prevTop || null);
    const typedReps = firstWork ? parse(firstWork.reps) : null;
    const reps = sug.presc?.reps[0] ?? (typedReps != null && !Number.isNaN(typedReps) && typedReps > 0 ? typedReps : null) ?? ex.plan?.rep_min ?? 8;
    const equipment = info?.equipment ?? "barbell";
    if (working == null && equipment !== "bodyweight") {
      setError("Enter the working weight on the first set, then tap Warm-ups again.");
      return;
    }
    const inc = ex.plan?.increment_kg ?? info?.increment_kg ?? settings.weight_increment;
    const ramp = warmupRamp(working ?? 0, reps, { equipment, inc });
    if (!ramp.length) {
      setError(`${fmtKg(working ?? 0)} kg is light enough that a warm-up set isn't needed. Start with your first working set.`);
      return;
    }
    setError(null);
    updEx(ex.key, (e) => {
      // Replace any untouched warm-up rows; keep ones you've already filled or ticked
      const kept = e.sets.filter((x) => x.set_type !== "warmup" || x.done || x.weight || x.reps);
      const fresh: LSet[] = ramp.map((r) => ({ key: uid(), set_type: "warmup", weight: fmtKg(r.kg), reps: String(r.reps), rpe: "", done: false }));
      return { ...e, sets: [...fresh, ...kept] };
    });
  }

  function cycleType(ek: string, sk: string) {
    const order: SetType[] = ["working", "warmup", "drop", "failure"];
    updSet(ek, sk, (s) => ({ ...s, set_type: order[(order.indexOf(s.set_type) + 1) % order.length] }));
  }

  function collect(): { sets: WSet[]; skipped: number } | string {
    const sets: WSet[] = [];
    let skipped = 0;
    let pos = 0;
    for (const ex of draft.exercises) {
      const name = exMap.get(ex.exercise_id)?.name ?? "Exercise";
      let n = 0;
      for (const s of ex.sets) {
        if (!s.done) { if (!draft.circuit && (s.weight || s.reps)) skipped++; continue; }
        const w = parse(s.weight) ?? 0;
        const r = parse(s.reps);
        const rpe = parse(s.rpe);
        if (Number.isNaN(w) || w < 0 || w > 1000) return `${name}: check the weight on set ${n + 1}.`;
        if (r == null || Number.isNaN(r) || r < 0 || r > 200 || !Number.isInteger(r)) return `${name}: reps should be a whole number.`;
        if (rpe != null && (Number.isNaN(rpe) || rpe < 5 || rpe > 10)) return `${name}: RPE should be between 5 and 10.`;
        n++;
        sets.push({ exercise_id: ex.exercise_id, exercise_position: pos, set_number: n, set_type: s.set_type, weight_kg: w, reps: r, rpe });
      }
      if (n > 0) pos++;
    }
    if (!sets.length) return "Tick off at least one set to save the workout.";
    return { sets, skipped };
  }

  const pending = collect();
  const skipped = typeof pending === "string" ? 0 : pending.skipped;

  async function finish() {
    const c = collect();
    if (typeof c === "string") { setError(c); return; }
    if (c.skipped && confirm !== "finish") { setConfirm("finish"); return; }
    let duration: number | null;
    let started = draft.started_at;
    if (isEdit) {
      const d = parse(draft.duration);
      duration = d == null || Number.isNaN(d) ? null : Math.min(600, Math.max(0, d));
    } else {
      duration = Math.min(600, Math.round(((Date.now() - new Date(draft.started_at).getTime()) / 60000) * 10) / 10);
    }
    if (Number.isNaN(new Date(started).getTime())) started = new Date().toISOString();
    setBusy(true);
    setError(null);
    try {
      const id = await saveWorkout({ id: draft.id, template_id: draft.template_id, checkin_id: draft.checkin_id ?? null, load_factor: isEdit ? undefined : adj && !draft.circuit ? adj.loadFactor : 1, program_id: draft.program_id ?? null, program_step: draft.program_step ?? null, name: draft.name, started_at: started, duration_min: duration, notes: draft.notes, sets: c.sets });
      // Done the program's next workout: move the rotation on (A → B → A …)
      const prog = !isEdit && draft.program_id != null && draft.program_step != null ? data.programs.find((p) => p.id === draft.program_id) : null;
      if (prog) await setNextStep(prog.id, advance(prog, draft.program_step!)).catch(() => {});
      if (!isEdit) writeDraft(null);
      onSaved(id, !isEdit);
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save. Check your connection.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    if (confirm !== "delete") { setConfirm("delete"); return; }
    setBusy(true);
    try { await deleteWorkout(draft.id); onDeleted(); } catch (e) {
      setError(e instanceof Error ? `Couldn't delete: ${e.message}` : "Couldn't delete.");
      setBusy(false);
    }
  }

  function discard() {
    if (isEdit) { onClose(); return; }
    const anyDone = draft.exercises.some((e) => e.sets.some((s) => s.done));
    if (anyDone && confirm !== "discard") { setConfirm("discard"); return; }
    writeDraft(null);
    onClose();
  }

  // ---- Conditioning rounds ----
  const circuit = !isEdit ? draft.circuit ?? null : null;
  const roundsDone = circuit ? Math.min(...draft.exercises.map((e) => e.sets.filter((x) => x.done).length)) : 0;
  const totalRounds = circuit ? Math.max(0, ...draft.exercises.map((e) => e.sets.length)) : 0;
  /** Weight/reps to suggest for an exercise in round r: what you did last round, else last session, else the plan. */
  function roundHint(ex: LExercise, r: number) {
    const before = [...ex.sets.slice(0, r)].reverse().find((x) => x.done);
    // Last time you did this conditioning workout (not a heavy strength day with the same exercise)
    const lastSame = workouts.find((w) => w.id !== draft.id && w.template_id === draft.template_id && w.started_at < draft.started_at && w.sets.some((x) => x.exercise_id === ex.exercise_id));
    const prev = lastSame?.sets.find((x) => x.exercise_id === ex.exercise_id && x.set_type !== "warmup");
    return { weight: before?.weight || (prev ? fmtKg(prev.weight_kg) : ""), reps: before?.reps || (ex.plan ? String(ex.plan.rep_min) : prev ? String(prev.reps) : "") };
  }
  function tickRound() {
    if (!circuit) return;
    const r = roundsDone;
    unlockAudio();
    const filled = draft.exercises.map((ex) => { const s = ex.sets[r]; const h = roundHint(ex, r); return { ex, weight: s?.weight || h.weight || "0", reps: s?.reps || h.reps }; });
    const missing = filled.find((f) => !f.reps);
    if (missing) { setError(`Enter the reps for ${exMap.get(missing.ex.exercise_id)?.name ?? "each exercise"} first.`); return; }
    setError(null);
    const last = r + 1 >= totalRounds;
    update((d) => ({
      ...d,
      restEnd: !last && circuit.rest > 0 ? Date.now() + circuit.rest * 1000 : d.restEnd,
      restTotal: !last && circuit.rest > 0 ? circuit.rest : d.restTotal,
      exercises: d.exercises.map((e) => {
        const f = filled.find((x) => x.ex.key === e.key)!;
        const sets = [...e.sets];
        while (sets.length <= r) sets.push(emptySet());
        sets[r] = { ...sets[r], weight: f.weight, reps: f.reps, done: true };
        return { ...e, sets };
      }),
    }));
  }
  const undoRound = () => update((d) => ({ ...d, restEnd: null, exercises: d.exercises.map((e) => ({ ...e, sets: e.sets.map((x, i) => (i === roundsDone - 1 ? { ...x, done: false } : x)) })) }));
  const addRound = () => update((d) => ({ ...d, circuit: d.circuit ? { ...d.circuit, rounds: d.circuit.rounds + 1 } : d.circuit, exercises: d.exercises.map((e) => ({ ...e, sets: [...e.sets, emptySet()] })) }));
  const setRoundVal = (ek: string, field: "weight" | "reps", v: string) => updEx(ek, (e) => {
    const sets = [...e.sets];
    while (sets.length <= roundsDone) sets.push(emptySet());
    // Weight carries to the rounds still to come; reps are this round's
    return { ...e, sets: sets.map((x, i) => (i === roundsDone || (field === "weight" && i > roundsDone && !x.done) ? { ...x, [field]: v } : x)) };
  });

  if (picking) {
    return (
      <ExercisePicker
        exercises={exercises}
        title={picking.replaceKey ? "Swap exercise" : "Add exercises"}
        onClose={() => setPicking(null)}
        onCreated={onCreatedExercise}
        onPick={(ids) => {
          if (picking.replaceKey) {
            updEx(picking.replaceKey, (e) => ({ ...e, exercise_id: ids[0] }));
          } else {
            update((d) => ({ ...d, exercises: [...d.exercises, ...ids.map((id) => ({ key: uid(), exercise_id: id, plan: null, sets: [emptySet(), emptySet(), emptySet()] }))] }));
          }
          setPicking(null);
        }}
      />
    );
  }

  // Warm-ups don't count towards volume
  const live = draft.exercises.flatMap((e) => e.sets.filter((s) => s.done && s.set_type !== "warmup").map((s) => ({ weight_kg: parse(s.weight) || 0, reps: parse(s.reps) || 0 })));
  const liveVolume = live.reduce((a, s) => a + s.weight_kg * s.reps, 0);
  const doneCount = draft.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done && s.set_type !== "warmup").length, 0);

  return (
    <>
      <div className="editor-bar">
        <input className="title-input" value={draft.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} aria-label="Workout name" />
        <button className="btn ghost" onClick={discard}>{isEdit ? "Close" : confirm === "discard" ? "Discard?" : "Discard"}</button>
      </div>

      {!isEdit ? (
        <div className={`timer sticky-timer${restLeft != null && restLeft <= 0 ? " over" : ""}`} role={restLeft != null ? "timer" : undefined} aria-live="polite">
          {restLeft != null ? (
            <>
              <div className="rest-fill" style={{ width: `${Math.max(0, Math.min(100, (restLeft / Math.max(1, draft.restTotal)) * 100))}%` }} />
              <span className="rest-label">
                <span className="clock running">{restLeft > 0 ? fmtRest(restLeft) : "Go"}</span>
                <span className="small" style={{ display: "block", opacity: 0.85, marginTop: 4 }}>
                  {restLeft > 0 ? "Resting" : "Rest over"}, workout {fmtClock(now - new Date(draft.started_at).getTime())}
                </span>
              </span>
              <span className="rest-btns">
                <button onClick={() => setDraft((d) => ({ ...d, restEnd: (d.restEnd ?? Date.now()) - 15000 }))} aria-label="15 seconds less">−15</button>
                <button onClick={() => setDraft((d) => ({ ...d, restEnd: (d.restEnd ?? Date.now()) + 15000, restTotal: d.restTotal + 15 }))} aria-label="15 seconds more">+15</button>
                <button onClick={() => setDraft((d) => ({ ...d, restEnd: null }))}>Skip</button>
              </span>
            </>
          ) : (
            <>
              <span>
                <span className="clock running">{fmtClock(now - new Date(draft.started_at).getTime())}</span>
                <span className="small" style={{ display: "block", opacity: 0.8, marginTop: 4 }}>
                  {circuit ? `Round ${Math.min(roundsDone + 1, totalRounds)} of ${totalRounds}, ${roundsDone} done` : `${doneCount} working set${doneCount === 1 ? "" : "s"}, ${fmtTonnage(liveVolume)}`}
                </span>
              </span>
              <button className="btn primary" onClick={finish} disabled={busy}>{busy ? "Saving…" : "Finish"}</button>
            </>
          )}
        </div>
      ) : (
        <div className="grid c2">
          <label className="field">
            <span>Started</span>
            <input className="input" type="datetime-local" value={toLocalInput(new Date(draft.started_at))}
              onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) update((x) => ({ ...x, started_at: d.toISOString() })); }} />
          </label>
          <label className="field">
            <span>Duration (min)</span>
            <input className="input" inputMode="decimal" value={draft.duration} onChange={(e) => update((d) => ({ ...d, duration: e.target.value }))} />
          </label>
        </div>
      )}

      {!isEdit && !draft.circuit && (planAdj ? (
        <div className={`ready-strip band-${planAdj.band}`}>
          <span className="ready-score sm">{planAdj.score}</span>
          <span style={{ flex: 1 }}>
            <strong>{BAND_LABEL[planAdj.band]}</strong>{" "}
            <span className="small">{draft.useAdj ? planAdj.headline : "Readiness ignored: full plan"}</span>
          </span>
          <button className="link small" onClick={() => update((d) => {
            const on = !d.useAdj;
            // Restore or trim planned sets on exercises you haven't started yet
            const exercises = d.exercises.map((e) => {
              if (!e.plan || d.circuit || e.sets.some((x) => x.done || x.weight || x.reps)) return e;
              const want = prescribe(e, on ? planAdj : null)?.sets ?? e.plan.sets;
              const working = e.sets.filter((x) => x.set_type !== "warmup");
              const warm = e.sets.filter((x) => x.set_type === "warmup");
              const next = working.length >= want ? working.slice(0, want) : [...working, ...Array.from({ length: want - working.length }, () => emptySet())];
              return { ...e, sets: [...warm, ...next] };
            });
            return { ...d, useAdj: on, exercises };
          })}>
            {draft.useAdj ? "Use full plan" : "Apply"}
          </button>
        </div>
      ) : (
        <button className="ready-strip none" onClick={onScan}>
          <span style={{ flex: 1, textAlign: "left" }}>No readiness scan today. <span className="small">Take one to adjust loads.</span></span>
          <span aria-hidden="true">›</span>
        </button>
      ))}
      {(() => {
        if (isEdit || !draft.template_id) return null;
        const tpl = templates.find((t) => t.id === draft.template_id);
        const started = draft.exercises.some((e) => e.sets.some((x) => x.done));
        const warmed = data.mobilitySessions.some((m) => m.kind === "prewarm" && m.template_id === draft.template_id && Date.now() - new Date(m.done_at).getTime() < 3 * 3600000);
        if (!tpl || started || warmed) return null;
        return (
          <button className="mob-strip slim" onClick={() => onWarmup(tpl)}>
            <span style={{ flex: 1, textAlign: "left" }}><strong>5-min mobility warm-up</strong> <span className="small">for the joints {tpl.name} loads, before your warm-up sets</span></span>
            <span aria-hidden="true">›</span>
          </button>
        );
      })()}
      {error && <p className="error panel" role="alert" style={{ marginTop: 10 }}>{error}</p>}

      {draft.exercises.length === 0 && (
        <div className="empty" style={{ marginTop: 14 }}>
          <p>Add your first exercise to start logging sets.</p>
        </div>
      )}

      {circuit && draft.exercises.length > 0 && (
        <section className="circuit panel">
          <div className="circuit-head">
            <h2>{roundsDone >= totalRounds ? "All rounds done" : `Round ${roundsDone + 1} of ${totalRounds}`}</h2>
            <span className="small muted">{circuit.rest > 0 ? `${fmtRest(circuit.rest)} rest between rounds` : "No rest between rounds"}</span>
          </div>
          <div className="round-dots" aria-hidden="true">{Array.from({ length: totalRounds }, (_, i) => <i key={i} className={i < roundsDone ? "on" : i === roundsDone ? "now" : ""} />)}</div>
          {roundsDone < totalRounds ? (
            <>
              <div className="circuit-grid circuit-headrow small muted" aria-hidden="true"><span>Exercise</span><span>kg</span><span>Reps</span></div>
              {draft.exercises.map((ex, i) => {
                const info = exMap.get(ex.exercise_id);
                const s = ex.sets[roundsDone];
                const h = roundHint(ex, roundsDone);
                return (
                  <div key={ex.key} className="circuit-grid circuit-row">
                    <span className="circuit-name"><span className="circuit-no">{i + 1}</span>{info?.name ?? "Exercise"}{(ex.plan?.notes || info?.notes) && <span className="small muted" style={{ display: "block" }}>{ex.plan?.notes || info?.notes}</span>}</span>
                    <input className="cell" inputMode="decimal" placeholder={h.weight || "–"} value={s?.weight ?? ""} aria-label={`${info?.name ?? "Exercise"} weight in kg`} onChange={(e) => setRoundVal(ex.key, "weight", e.target.value)} />
                    <input className="cell" inputMode="numeric" placeholder={h.reps} value={s?.reps ?? ""} aria-label={`${info?.name ?? "Exercise"} reps`} onChange={(e) => setRoundVal(ex.key, "reps", e.target.value)} />
                  </div>
                );
              })}
              <button className="btn primary block" style={{ marginTop: 12 }} onClick={tickRound}>✓ Round {roundsDone + 1} done</button>
            </>
          ) : (
            <button className="btn dark block" style={{ marginTop: 10 }} onClick={finish} disabled={busy}>{busy ? "Saving…" : "Finish workout"}</button>
          )}
          <div className="lift-actions">
            {roundsDone > 0 && <button className="link small" onClick={undoRound}>Undo round {roundsDone}</button>}
            <button className="link small" onClick={addRound}>+ Add a round</button>
          </div>
          {roundsDone > 0 && (
            <p className="small muted" style={{ marginTop: 6 }}>
              Done: {draft.exercises.map((ex) => { const d = ex.sets.filter((x) => x.done); const reps = d.reduce((a, x) => a + (parse(x.reps) || 0), 0); return `${exMap.get(ex.exercise_id)?.name ?? "Exercise"} ${reps} reps`; }).join(" · ")}
            </p>
          )}
        </section>
      )}

      {!circuit && draft.exercises.map((ex, ei) => {
        const info = exMap.get(ex.exercise_id);
        const sug = suggestions(ex);
        const doneSets: WSet[] = ex.sets.filter((s) => s.done).map((s, i) => ({ exercise_id: ex.exercise_id, exercise_position: 0, set_number: i + 1, set_type: s.set_type, weight_kg: parse(s.weight) || 0, reps: parse(s.reps) || 0, rpe: parse(s.rpe) }));
        const vol = volume(doneSets);
        const prevVol = sug.prev ? volume(sug.prev.sets) : null;
        const top = bestE1rm(doneSets, formula);
        const prevTop = sug.prev ? bestE1rm(sug.prev.sets, formula) : null;
        const ref = sug.ref ?? top;
        let workingN = 0;
        return (
          <section className="lift-block" key={ex.key}>
            <div className="lift-head">
              <div>
                <h2>{info?.name ?? "Exercise"}</h2>
                <p className="muted small">
                  {info ? MUSCLE_LABEL[info.muscle] : ""}
                  {ex.plan && `, target ${ex.plan.sets} × ${ex.plan.rep_min === ex.plan.rep_max ? ex.plan.rep_min : `${ex.plan.rep_min}–${ex.plan.rep_max}`}${ex.plan.target_rpe ? ` @ RPE ${ex.plan.target_rpe}` : ""}`}
                  {`, rest ${fmtRest(ex.plan?.rest_sec ?? settings.default_rest_sec)}`}
                </p>
              </div>
              <div className="lift-tools">
                <button className="icon-btn" aria-label="Move up" disabled={ei === 0} onClick={() => update((d) => { const a = [...d.exercises]; [a[ei - 1], a[ei]] = [a[ei], a[ei - 1]]; return { ...d, exercises: a }; })}>↑</button>
                <button className="icon-btn" aria-label="Move down" disabled={ei === draft.exercises.length - 1} onClick={() => update((d) => { const a = [...d.exercises]; [a[ei + 1], a[ei]] = [a[ei], a[ei + 1]]; return { ...d, exercises: a }; })}>↓</button>
                <button className="icon-btn" aria-label="Swap exercise" onClick={() => setPicking({ replaceKey: ex.key })}>⇄</button>
                <button className="icon-btn" aria-label="Remove exercise" onClick={() => update((d) => ({ ...d, exercises: d.exercises.filter((x) => x.key !== ex.key) }))}>✕</button>
              </div>
            </div>
            {(ex.plan?.notes || info?.notes) && <p className="small lift-note">{ex.plan?.notes || info?.notes}</p>}
            {sug.presc && (
              <div className={`coach-box tone-${STATUS_TONE[sug.presc.status]}`}>
                <div className="coach-top">
                  <span className="coach-chip">{STATUS_LABEL[sug.presc.status]}</span>
                  <strong className="coach-head">{sug.presc.headline}</strong>
                </div>
                <p className="small">{sug.presc.why}</p>
              </div>
            )}

            <div className="set-grid set-head" aria-hidden="true">
              <span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>RPE</span><span />
            </div>
            {ex.sets.map((s, si) => {
              if (s.set_type !== "warmup") workingN++;
              const ph = placeholderFor(ex, si, sug);
              const p = prevMatch(ex, si, sug);
              const w = parse(s.weight || (s.done ? "" : ph.weight));
              const pct = ref && w && s.set_type !== "warmup" ? Math.round((w / ref) * 100) : null;
              return (
                <div key={s.key} className={`set-grid set-row${s.done ? " done" : ""}`}>
                  <button className={`set-no ${s.set_type}`} onClick={() => cycleType(ex.key, s.key)} aria-label={`Set ${si + 1}, ${SET_TYPE_LABEL[s.set_type]}. Tap to change type`}>
                    {SET_TYPE_SHORT[s.set_type] || workingN}
                  </button>
                  <span className="prev">
                    {p ? `${fmtKg(p.weight_kg)} × ${p.reps}${p.rpe ? ` @${p.rpe}` : ""}` : "–"}
                  </span>
                  <span className="kgwrap">
                    <input className="cell" inputMode="decimal" placeholder={ph.weight} value={s.weight} aria-label="Weight in kg"
                      onChange={(e) => updSet(ex.key, s.key, (x) => ({ ...x, weight: e.target.value }))} />
                    {pct != null && <span className="pct" title="Percent of your estimated 1RM">{pct}%</span>}
                  </span>
                  <input className="cell" inputMode="numeric" placeholder={ph.reps} value={s.reps} aria-label="Reps"
                    onChange={(e) => updSet(ex.key, s.key, (x) => ({ ...x, reps: e.target.value }))} />
                  <input className="cell" inputMode="decimal" placeholder={ph.rpe} value={s.rpe} aria-label="RPE"
                    onChange={(e) => updSet(ex.key, s.key, (x) => ({ ...x, rpe: e.target.value }))} />
                  <button className={`check${s.done ? " on" : ""}`} aria-pressed={s.done} aria-label={s.done ? "Untick set" : "Tick set as done"} onClick={() => toggleDone(ex, si, sug)}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </button>
                </div>
              );
            })}
            <div className="lift-actions">
              <button className="link small" onClick={() => updEx(ex.key, (e) => ({ ...e, sets: [...e.sets, emptySet(e.sets[e.sets.length - 1]?.set_type === "warmup" ? "warmup" : "working")] }))}>+ Add set</button>
              {ex.sets.some((x) => x.set_type === "warmup")
                ? <button className="link small" onClick={() => updEx(ex.key, (e) => { const i = e.sets.map((x) => x.set_type).lastIndexOf("warmup"); const a = [...e.sets]; a.splice(i + 1, 0, emptySet("warmup")); return { ...e, sets: a }; })}>+ Warm-up set</button>
                : <button className="link small" onClick={() => addWarmups(ex, sug)}>+ Warm-ups</button>}
              {ex.sets.length > 0 && <button className="link small" onClick={() => updEx(ex.key, (e) => ({ ...e, sets: e.sets.slice(0, -1) }))}>Remove last</button>}
            </div>
            {doneSets.length > 0 && (
              <div className="lift-stats">
                <span>Volume <strong>{fmtTonnage(vol)}</strong>{prevVol ? <span className="muted"> of {fmtTonnage(prevVol)} last time</span> : null}</span>
                {top != null && <span>Top e1RM <strong>{fmtKg(Math.round(top * 10) / 10)} kg</strong>{prevTop ? <Delta v={pctChange(top, prevTop)} /> : null}</span>}
              </div>
            )}
          </section>
        );
      })}

      {!circuit && <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => setPicking({})}>+ Add exercise</button>}

      <section className="section">
        <label className="field">
          <span>Notes</span>
          <textarea className="input" value={draft.notes} placeholder="How the session went" onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} />
        </label>
      </section>

      <div className="save-bar static">
        {confirm === "finish" && <p className="panel small">{skipped} set{skipped === 1 ? " has" : "s have"} numbers but {skipped === 1 ? "isn't" : "aren't"} ticked and won't be saved.</p>}
        <button className="btn dark block" onClick={finish} disabled={busy}>
          {busy ? "Saving…" : confirm === "finish" ? "Finish anyway" : isEdit ? "Save changes" : "Finish workout"}
        </button>
      </div>

      {isEdit && (
        <div style={{ marginTop: 28 }}>
          <button className="btn danger block" onClick={remove} disabled={busy}>{confirm === "delete" ? "Tap again to delete this workout" : "Delete workout"}</button>
        </div>
      )}

    </>
  );
}

export function Delta({ v, unit = "%", digits = 1 }: { v: number | null; unit?: string; digits?: number }) {
  if (v == null || !Number.isFinite(v)) return null;
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  const cls = r > 0 ? "up" : r < 0 ? "down" : "flat";
  return <span className={`delta ${cls}`}>{r > 0 ? "+" : ""}{r}{unit}</span>;
}
