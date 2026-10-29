import { useState } from "react";
import type { AppData } from "../App";
import type { Program } from "../lib/programs";
import { deleteProgram, saveProgram, setActiveProgram } from "../lib/programs";

interface Props {
  program: Program | null;
  data: AppData;
  onClose: () => void;
  onSaved: () => void;
}

export default function ProgramEditor({ program, data, onClose, onSaved }: Props) {
  const { templates } = data;
  const [name, setName] = useState(program?.name ?? "");
  const [notes, setNotes] = useState(program?.notes ?? "");
  const [steps, setSteps] = useState<string[]>(() => (program?.steps ?? []).filter((id) => templates.some((t) => t.id === id)));
  const [active, setActive] = useState(program ? data.activeProgramId === program.id : data.activeProgramId == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const tName = (id: string) => templates.find((t) => t.id === id)?.name ?? "Workout";
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));

  const move = (i: number, d: -1 | 1) => setSteps((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const n = [...s];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  async function save() {
    if (!name.trim()) return setError("Give the program a name.");
    if (!steps.length) return setError("Add at least one workout.");
    setBusy(true);
    setError(null);
    try {
      // Editing the order restarts the rotation at the first workout, unless the steps are unchanged
      const same = program && program.steps.length === steps.length && program.steps.every((s, i) => s === steps[i]);
      const id = await saveProgram({ id: program?.id, name, notes, steps, next_step: same ? undefined : 0 });
      const wasActive = program ? data.activeProgramId === program.id : false;
      if (active && !wasActive) await setActiveProgram(id);
      if (!active && wasActive) await setActiveProgram(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!program) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true);
    try {
      await deleteProgram(program.id);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="editor-bar">
        <h1>{program ? "Edit program" : "New program"}</h1>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <div className="panel stack">
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hypertrophy block" maxLength={80} />
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 8 weeks, 4 days a week" />
        </label>
      </div>

      <section className="section">
        <h2 style={{ marginBottom: 4 }}>Rotation</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>Workouts run in this order and start again from the top. Add a template more than once for patterns like A, B, A, C.</p>
        {steps.length > 0 && (
          <div className="panel list-panel">
            {steps.map((id, i) => (
              <div key={`${id}-${i}`} className="list-row static prog-step">
                <span className="prog-letter" aria-hidden="true">{letter(i)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{tName(id)}</strong>
                  <span className="small muted" style={{ display: "block" }}>{(() => { const n = templates.find((t) => t.id === id)?.exercises.length ?? 0; return `${n} exercise${n === 1 ? "" : "s"}`; })()}</span>
                </span>
                <span className="prog-tools">
                  <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down">↓</button>
                  <button className="icon-btn" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} aria-label={`Remove ${tName(id)}`}>✕</button>
                </span>
              </div>
            ))}
          </div>
        )}
        {templates.length ? (
          <div className="nig-grid" style={{ marginTop: 10 }}>
            {templates.map((t) => (
              <button key={t.id} className="fchip" onClick={() => setSteps((s) => [...s, t.id])}>+ {t.name}</button>
            ))}
          </div>
        ) : (
          <p className="small">Create a workout template first, then add it here.</p>
        )}
      </section>

      <label className="toggle" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Make this my active program<span className="small muted" style={{ display: "block" }}>Next up follows this rotation. You can still start any template on its own.</span></span>
      </label>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save program"}</button>
      </div>
      {program && (
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={remove} disabled={busy}>
          {confirmDel ? "Tap again to delete (templates and history are kept)" : "Delete program"}
        </button>
      )}
    </>
  );
}
