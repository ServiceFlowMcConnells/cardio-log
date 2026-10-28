import { useMemo, useState } from "react";
import type { AppData } from "../App";
import type { Template, TemplateExercise } from "../lib/strength";
import { MUSCLE_LABEL } from "../lib/strength";
import type { OnStall, Plan, Progression } from "../lib/coach";
import { STATUS_LABEL, coachExercise, incrementFor, ruleText } from "../lib/coach";
import { deleteTemplate, saveTemplate } from "../lib/strengthData";
import ExercisePicker from "./ExercisePicker";

interface Row {
  key: string; exercise_id: string; sets: string; rep_min: string; rep_max: string; target_rpe: string; rest: string; notes: string;
  progression: Progression; on_stall: OnStall; incr: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const toRow = (e: TemplateExercise): Row => ({
  key: uid(), exercise_id: e.exercise_id, sets: String(e.sets), rep_min: String(e.rep_min), rep_max: String(e.rep_max),
  target_rpe: e.target_rpe != null ? String(e.target_rpe) : "", rest: e.rest_sec != null ? String(e.rest_sec) : "", notes: e.notes ?? "",
  progression: e.progression ?? (e.rep_min === e.rep_max ? "fixed" : "rep_range"), on_stall: e.on_stall ?? "preserve",
  incr: e.increment_kg != null ? String(e.increment_kg) : "",
});

interface Props {
  template: Template | null;
  data: AppData;
  onClose: () => void;
  onSaved: () => void;
  onCreatedExercise: () => void;
}

export default function TemplateEditor({ template, data, onClose, onSaved, onCreatedExercise }: Props) {
  const { exercises, workouts, settings } = data;
  const [name, setName] = useState(template?.name ?? "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() => (template?.exercises ?? []).map(toRow));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exMap = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const nowIso = new Date().toISOString();

  const upd = (key: string, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function save() {
    if (!name.trim()) return setError("Give the template a name, e.g. Upper A or Push.");
    if (!rows.length) return setError("Add at least one exercise.");
    const out: TemplateExercise[] = [];
    for (const [i, r] of rows.entries()) {
      const ex = exMap.get(r.exercise_id)?.name ?? "Exercise";
      const sets = Number(r.sets), lo = Number(r.rep_min), hi = r.progression === "fixed" ? lo : Number(r.rep_max || r.rep_min);
      const rpe = r.target_rpe.trim() ? Number(r.target_rpe.replace(",", ".")) : null;
      const rest = r.rest.trim() ? Number(r.rest) : null;
      const incr = r.incr.trim() ? Number(r.incr.replace(",", ".")) : null;
      if (incr != null && !(incr > 0 && incr <= 20)) return setError(`${ex}: weight jump should be 0.25 to 20 kg, or blank.`);
      if (!Number.isInteger(sets) || sets < 1 || sets > 20) return setError(`${ex}: sets should be 1 to 20.`);
      if (!Number.isInteger(lo) || lo < 1 || lo > 100) return setError(`${ex}: reps should be a whole number.`);
      if (!Number.isInteger(hi) || hi < lo || hi > 100) return setError(`${ex}: the top of the rep range should be at least ${lo}.`);
      if (rpe != null && (Number.isNaN(rpe) || rpe < 5 || rpe > 10)) return setError(`${ex}: target RPE should be 5 to 10.`);
      if (rest != null && (!Number.isInteger(rest) || rest < 0 || rest > 900)) return setError(`${ex}: rest should be 0 to 900 seconds.`);
      out.push({ exercise_id: r.exercise_id, position: i, sets, rep_min: lo, rep_max: hi, target_rpe: rpe, rest_sec: rest, notes: r.notes || null,
        progression: r.progression, on_stall: r.on_stall, increment_kg: incr });
    }
    setBusy(true);
    setError(null);
    try {
      await saveTemplate({ id: template?.id, name, notes, exercises: out });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!template) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try { await deleteTemplate(template.id); onSaved(); } catch (e) {
      setError(e instanceof Error ? `Couldn't delete: ${e.message}` : "Couldn't delete.");
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <ExercisePicker
        exercises={exercises}
        onClose={() => setPicking(false)}
        onCreated={onCreatedExercise}
        onPick={(ids) => {
          setRows((r) => [...r, ...ids.map((id) => ({ key: uid(), exercise_id: id, sets: "3", rep_min: "8", rep_max: "10", target_rpe: "8", rest: "", notes: "", progression: "rep_range" as Progression, on_stall: "preserve" as OnStall, incr: "" }))]);
          setPicking(false);
        }}
      />
    );
  }

  return (
    <>
      <div className="editor-bar">
        <h1>{template ? "Edit template" : "New template"}</h1>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
      <div className="stack">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper A" />
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Focus, tempo, anything to remember" />
        </label>
      </div>

      <section className="section">
        {rows.length === 0 && <div className="empty"><p>Add the exercises for this workout, then set sets × reps for each.</p></div>}
        {rows.map((r, i) => {
          const info = exMap.get(r.exercise_id);
          const rpe = r.target_rpe.trim() ? Number(r.target_rpe.replace(",", ".")) : null;
          const lo = Number(r.rep_min), hi = r.progression === "fixed" ? lo : Number(r.rep_max || r.rep_min);
          const sets = Number(r.sets);
          const incr = r.incr.trim() ? Number(r.incr.replace(",", ".")) : null;
          const valid = Number.isInteger(lo) && lo >= 1 && Number.isInteger(hi) && hi >= lo && Number.isInteger(sets) && sets >= 1;
          const plan: Plan | null = valid ? {
            sets, rep_min: lo, rep_max: hi, target_rpe: rpe != null && !Number.isNaN(rpe) ? rpe : null,
            progression: r.progression, on_stall: r.on_stall, increment_kg: incr != null && incr > 0 ? incr : null,
          } : null;
          const jump = plan?.increment_kg ?? incrementFor(info, settings.weight_increment);
          const presc = plan
            ? coachExercise(info, r.exercise_id, plan, workouts, data.templates, nowIso, { formula: settings.e1rm_formula, inc: settings.weight_increment, adj: null, deload: false })
            : null;
          return (
            <div className="block-card strength" key={r.key}>
              <div className="head">
                <h3>{info?.name ?? "Exercise"}</h3>
                <span className="lift-tools">
                  <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => setRows((a) => { const b = [...a]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; return b; })}>↑</button>
                  <button className="icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => setRows((a) => { const b = [...a]; [b[i + 1], b[i]] = [b[i], b[i + 1]]; return b; })}>↓</button>
                  <button className="icon-btn" aria-label={`Remove ${info?.name ?? "exercise"}`} onClick={() => setRows((a) => a.filter((x) => x.key !== r.key))}>✕</button>
                </span>
              </div>
              <p className="last">{info ? MUSCLE_LABEL[info.muscle] : ""}</p>
              <div className="seg" role="group" aria-label="Progression rule" style={{ marginBottom: 10 }}>
                <button className={r.progression === "rep_range" ? "on" : ""} aria-pressed={r.progression === "rep_range"}
                  onClick={() => upd(r.key, { progression: "rep_range", rep_max: r.rep_max === r.rep_min ? String(Number(r.rep_min) + 2 || "") : r.rep_max })}>Rep range</button>
                <button className={r.progression === "fixed" ? "on" : ""} aria-pressed={r.progression === "fixed"}
                  onClick={() => upd(r.key, { progression: "fixed" })}>Fixed reps</button>
              </div>
              <div className={`grid ${r.progression === "fixed" ? "c3" : "c4"}`}>
                <label className="field"><span>Sets</span><input className="input" inputMode="numeric" value={r.sets} onChange={(e) => upd(r.key, { sets: e.target.value })} /></label>
                {r.progression === "fixed" ? (
                  <label className="field"><span>Reps</span><input className="input" inputMode="numeric" value={r.rep_min} onChange={(e) => upd(r.key, { rep_min: e.target.value, rep_max: e.target.value })} /></label>
                ) : (
                  <>
                    <label className="field"><span>Reps from</span><input className="input" inputMode="numeric" value={r.rep_min} onChange={(e) => upd(r.key, { rep_min: e.target.value })} /></label>
                    <label className="field"><span>Reps to</span><input className="input" inputMode="numeric" value={r.rep_max} onChange={(e) => upd(r.key, { rep_max: e.target.value })} /></label>
                  </>
                )}
                <label className="field"><span>Target RPE</span><input className="input" inputMode="decimal" value={r.target_rpe} placeholder="–" onChange={(e) => upd(r.key, { target_rpe: e.target.value })} /></label>
              </div>
              <div className="grid c2" style={{ marginTop: 10 }}>
                <label className="field"><span>Weight jump (kg)</span><input className="input" inputMode="decimal" value={r.incr} placeholder={String(incrementFor(info, settings.weight_increment))} onChange={(e) => upd(r.key, { incr: e.target.value })} /></label>
                <label className="field"><span>Rest (seconds)</span><input className="input" inputMode="numeric" value={r.rest} placeholder={String(settings.default_rest_sec)} onChange={(e) => upd(r.key, { rest: e.target.value })} /></label>
              </div>
              <label className="field" style={{ marginTop: 10 }}>
                <span>When progress stalls or strength slips</span>
                <select className="input" value={r.on_stall} onChange={(e) => upd(r.key, { on_stall: e.target.value as OnStall })}>
                  <option value="preserve">Preserve muscle (best in a deficit)</option>
                  <option value="reset">Reset and rebuild</option>
                </select>
              </label>
              <label className="field" style={{ marginTop: 10 }}><span>Note</span><input className="input" value={r.notes} placeholder="Optional" onChange={(e) => upd(r.key, { notes: e.target.value })} /></label>
              {plan && <p className="small rule-box">{ruleText(plan, jump)}</p>}
              <p className="small muted" style={{ marginTop: 8 }}>
                {presc?.weight != null
                  ? `Coach, next time: ${presc.headline} (${STATUS_LABEL[presc.status].toLowerCase()}).`
                  : "The coach sets weights from your first session with this exercise."}
              </p>
            </div>
          );
        })}
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setPicking(true)}>+ Add exercises</button>
      </section>

      <div className="save-bar">
        {error && <p className="error panel" role="alert">{error}</p>}
        <button className="btn dark block" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save template"}</button>
      </div>
      {template && (
        <div style={{ marginTop: 28 }}>
          <button className="btn danger block" onClick={remove} disabled={busy}>{confirmDelete ? "Tap again to delete this template" : "Delete template"}</button>
          <p className="muted small" style={{ marginTop: 6 }}>Workouts you've already logged from it are kept.</p>
        </div>
      )}
    </>
  );
}
