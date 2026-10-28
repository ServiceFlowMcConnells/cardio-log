import { useMemo, useState } from "react";
import type { Equipment, Exercise, Muscle } from "../lib/strength";
import { EQUIPMENT, EQUIPMENT_LABEL, MUSCLES, MUSCLE_LABEL } from "../lib/strength";
import { saveExercise } from "../lib/strengthData";

interface Props {
  exercises: Exercise[];
  title?: string;
  onPick: (ids: string[]) => void;
  onClose: () => void;
  onCreated: () => void;
}

/** Full-screen picker: search, filter by muscle, select several, or create a new exercise. */
export default function ExercisePicker({ exercises, title = "Add exercises", onPick, onClose, onCreated }: Props) {
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<Muscle | "all">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [extra, setExtra] = useState<Exercise[]>([]);

  const all = useMemo(() => [...exercises, ...extra.filter((e) => !exercises.some((x) => x.id === e.id))], [exercises, extra]);
  const list = all
    .filter((e) => !e.archived)
    .filter((e) => muscle === "all" || e.muscle === muscle)
    .filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const usedMuscles = MUSCLES.filter((m) => all.some((e) => e.muscle === m && !e.archived));

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="picker">
      <div className="editor-bar">
        <h1>{title}</h1>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
      <input className="input" type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
      {usedMuscles.length > 1 && (
        <div className="chips-row" role="group" aria-label="Filter by muscle">
          <button className={`fchip${muscle === "all" ? " on" : ""}`} onClick={() => setMuscle("all")}>All</button>
          {usedMuscles.map((m) => (
            <button key={m} className={`fchip${muscle === m ? " on" : ""}`} onClick={() => setMuscle(m)}>{MUSCLE_LABEL[m]}</button>
          ))}
        </div>
      )}

      {creating ? (
        <NewExerciseForm
          initialName={q}
          onCancel={() => setCreating(false)}
          onSaved={(e) => {
            setExtra((x) => [...x, e]);
            setPicked((p) => [...p, e.id]);
            setCreating(false);
            setQ("");
            onCreated();
          }}
        />
      ) : (
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
          New exercise{q.trim() ? `: "${q.trim()}"` : ""}
        </button>
      )}

      <div className="pick-list">
        {list.length === 0 && <p className="muted small" style={{ padding: "12px 4px" }}>No exercises match. Create one above.</p>}
        {list.map((e) => {
          const on = picked.includes(e.id);
          return (
            <button key={e.id} className={`pick-row${on ? " on" : ""}`} onClick={() => toggle(e.id)} aria-pressed={on}>
              <span>
                <strong>{e.name}</strong>
                <span className="muted small" style={{ display: "block" }}>{MUSCLE_LABEL[e.muscle]}, {EQUIPMENT_LABEL[e.equipment].toLowerCase()}</span>
              </span>
              <span className="tick" aria-hidden="true">{on ? picked.indexOf(e.id) + 1 : ""}</span>
            </button>
          );
        })}
      </div>

      <div className="save-bar">
        <button className="btn dark block" disabled={!picked.length} onClick={() => onPick(picked)}>
          {picked.length ? `Add ${picked.length} exercise${picked.length === 1 ? "" : "s"}` : "Select exercises"}
        </button>
      </div>
    </div>
  );
}

export function NewExerciseForm({ initialName = "", existing, onCancel, onSaved }: { initialName?: string; existing?: Exercise; onCancel: () => void; onSaved: (e: Exercise) => void }) {
  const [name, setName] = useState(existing?.name ?? initialName);
  const [muscle, setMuscle] = useState<Muscle>(existing?.muscle ?? "chest");
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? "barbell");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [incr, setIncr] = useState(existing?.increment_kg != null ? String(existing.increment_kg) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim()) return setError("Give the exercise a name.");
    setBusy(true);
    setError(null);
    try {
      const incN = incr.trim() ? Number(incr.replace(",", ".")) : null;
      if (incN != null && !(incN > 0 && incN <= 20)) { setError("Weight jump should be between 0.25 and 20 kg, or blank."); setBusy(false); return; }
      const e = await saveExercise({ id: existing?.id, name, muscle, equipment, notes, archived: existing?.archived ?? false, increment_kg: incN });
      onSaved(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the exercise.");
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" style={{ marginTop: 10 }} onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Incline Bench Press" />
      </label>
      <div className="grid c2">
        <label className="field">
          <span>Main muscle</span>
          <select className="input" value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle)}>
            {MUSCLES.map((m) => <option key={m} value={m}>{MUSCLE_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Equipment</span>
          <select className="input" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {EQUIPMENT.map((m) => <option key={m} value={m}>{EQUIPMENT_LABEL[m]}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Weight jump for this exercise (kg)</span>
        <input className="input" inputMode="decimal" value={incr} onChange={(e) => setIncr(e.target.value)} placeholder="Blank = your default" />
      </label>
      <label className="field">
        <span>Notes (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Seat height, grip, cues" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="grid c2">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn dark" disabled={busy}>{busy ? "Saving…" : existing ? "Save exercise" : "Create exercise"}</button>
      </div>
    </form>
  );
}
