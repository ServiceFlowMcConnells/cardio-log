import { useEffect, useMemo, useState } from "react";
import type { AppData } from "../App";
import type { SetType, Template, WSet, Workout } from "../lib/strength";
import {
  MUSCLE_LABEL, SET_TYPE_LABEL, SET_TYPE_SHORT, bestE1rm, bestE1rmBefore, fmtKg, fmtTonnage,
  pctChange, previousFor, roundTo, suggestWorking, volume,
} from "../lib/strength";
import { toLocalInput } from "../lib/dates";
import type { Adjustment, Checkin } from "../lib/readiness";
import { BAND_LABEL, adjustedRpe, adjustedSets, adjustmentFor } from "../lib/readiness";
import { deleteWorkout, saveWorkout } from "../lib/strengthData";
import ExercisePicker from "./ExercisePicker";

interface Plan { sets: number; rep_min: number; rep_max: number; target_rpe: number | null; rest_sec: number | null; notes: string | null }
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
  checkinScore?: number | null;
  checkinSoreness?: number | null;
  useAdj?: boolean;
}

const DRAFT_KEY = "cardio-log:workout-draft";
const uid = () => Math.random().toString(36).slice(2, 10);

export function hasWorkoutDraft(): boolean {
  try { return Boolean(localStorage.getItem(DRAFT_KEY)); } catch { return false; }
}
export function readWorkoutDraft(): Draft | null {
  try { const r = localStorage.getItem(DRAFT_KEY); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
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

function fromTemplate(t: Template | null, checkin: Checkin | null): Draft {
  const adj = checkin ? adjustmentFor(checkin) : null;
  return {
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
      plan: { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, rest_sec: te.rest_sec, notes: te.notes },
      sets: Array.from({ length: adjustedSets(te.sets, adj) }, () => emptySet()),
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
    name: w.name,
    started_at: w.started_at,
    duration: w.duration_min != null ? String(w.duration_min) : "",
    notes: w.notes ?? "",
    exercises: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, sets]) => {
      const te = t?.exercises.find((x) => x.exercise_id === sets[0].exercise_id);
      return {
        key: uid(),
        exercise_id: sets[0].exercise_id,
        plan: te ? { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, rest_sec: te.rest_sec, notes: te.notes } : null,
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
}

export default function WorkoutLogger({ workout, template, data, onClose, onSaved, onDeleted, onCreatedExercise, checkin, onScan }: Props) {
  const { exercises, workouts, settings, templates } = data;
  const isEdit = Boolean(workout);
  const [draft, setDraft] = useState<Draft>(() => {
    if (workout) return fromWorkout(workout, templates);
    const saved = readWorkoutDraft();
    if (saved && !saved.id) return saved;
    return fromTemplate(template, checkin);
  });
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState<null | { replaceKey?: string }>(null);
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
  const factor = adj?.loadFactor ?? 1;
  useEffect(() => {
    if (isEdit) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isEdit]);

  // Rest timer: buzz once when it hits zero.
  const restLeft = draft.restEnd ? Math.ceil((draft.restEnd - now) / 1000) : null;
  useEffect(() => {
    if (restLeft === 0) {
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
    }
    if (restLeft != null && restLeft < -4) setDraft((d) => ({ ...d, restEnd: null }));
  }, [restLeft]);

  const update = (fn: (d: Draft) => Draft) => { setConfirm(null); setDraft(fn); };
  const updEx = (key: string, fn: (e: LExercise) => LExercise) => update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? fn(e) : e)) }));
  const updSet = (ek: string, sk: string, fn: (s: LSet) => LSet) => updEx(ek, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === sk ? fn(s) : s)) }));

  /** What to pre-fill for a set: previous performance, progression, or a target-RPE load from your e1RM. */
  function suggestions(ex: LExercise) {
    const prev = previousFor(ex.exercise_id, workouts, draft.started_at, draft.id);
    // Reference for the %1RM shown per set (same as the workout summary uses)
    const ref = bestE1rmBefore(ex.exercise_id, workouts, draft.started_at, formula, draft.id);
    const rpeToday = adjustedRpe(ex.plan?.target_rpe ?? null, adj);
    const s = suggestWorking(ex.exercise_id, ex.plan, workouts, draft.started_at, {
      formula, inc, excludeId: draft.id, loadFactor: factor,
      allowProgression: adj ? adj.allowProgression : true,
      readinessLabel: adj ? BAND_LABEL[adj.band].toLowerCase() : undefined,
    });
    const why = s.why && rpeToday != null ? `${s.why}. Stop at RPE ${rpeToday}` : s.why;
    return { prev, ref, workingKg: s.kg, increased: s.increased, why, rpeToday };
  }

  function placeholderFor(ex: LExercise, idx: number, sug: ReturnType<typeof suggestions>) {
    const s = ex.sets[idx];
    const p = prevMatch(ex, idx, sug);
    const weight = s.set_type !== "warmup" && sug.workingKg != null ? fmtKg(sug.workingKg) : p ? fmtKg(p.weight_kg) : "";
    const working = s.set_type !== "warmup";
    // After a weight increase aim for the bottom of the rep range; otherwise beat last time's reps.
    const reps = working && ex.plan && sug.increased ? String(ex.plan.rep_min) : p ? String(p.reps) : working && ex.plan ? String(ex.plan.rep_min) : "";
    const rpe = s.set_type !== "warmup" && sug.rpeToday != null ? String(sug.rpeToday) : "";
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
      const rest = ex.plan?.rest_sec ?? settings.default_rest_sec;
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
        if (!s.done) { if (s.weight || s.reps) skipped++; continue; }
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
      const id = await saveWorkout({ id: draft.id, template_id: draft.template_id, checkin_id: draft.checkin_id ?? null, name: draft.name, started_at: started, duration_min: duration, notes: draft.notes, sets: c.sets });
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

  const live = draft.exercises.flatMap((e) => e.sets.filter((s) => s.done).map((s) => ({ weight_kg: parse(s.weight) || 0, reps: parse(s.reps) || 0 })));
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
                  {doneCount} working set{doneCount === 1 ? "" : "s"}, {fmtTonnage(liveVolume)}
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

      {!isEdit && (planAdj ? (
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
              if (!e.plan || e.sets.some((x) => x.done || x.weight || x.reps)) return e;
              const want = on ? adjustedSets(e.plan.sets, planAdj) : e.plan.sets;
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
      {error && <p className="error panel" role="alert" style={{ marginTop: 10 }}>{error}</p>}

      {draft.exercises.length === 0 && (
        <div className="empty" style={{ marginTop: 14 }}>
          <p>Add your first exercise to start logging sets.</p>
        </div>
      )}

      {draft.exercises.map((ex, ei) => {
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
            {sug.why && !isEdit && <p className="small suggest">{sug.why}.</p>}

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
              <button className="link small" onClick={() => updEx(ex.key, (e) => ({ ...e, sets: [emptySet("warmup"), ...e.sets] }))}>+ Warm-up</button>
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

      <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => setPicking({})}>+ Add exercise</button>

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
