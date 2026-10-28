import { useState } from "react";
import type { AppData } from "../App";
import type { Muscle } from "../lib/strength";
import { COMMON_EXERCISES, EQUIPMENT_LABEL, MUSCLES, MUSCLE_LABEL, bestE1rm, fmtKg } from "../lib/strength";
import { addExercises } from "../lib/strengthData";
import { formatShort } from "../lib/dates";
import { NewExerciseForm } from "./ExercisePicker";

export default function ExerciseLibrary({ data, onOpen, onChanged }: { data: AppData; onOpen: (id: string) => void; onChanged: () => void }) {
  const { exercises, workouts, settings } = data;
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const have = new Set(exercises.map((e) => e.name.toLowerCase()));
  const missingCommon = COMMON_EXERCISES.filter((c) => !have.has(c.name.toLowerCase()));

  async function addCommon() {
    setBusy(true);
    setError(null);
    try {
      await addExercises(missingCommon);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add exercises.");
    } finally {
      setBusy(false);
    }
  }

  const list = exercises
    .filter((e) => showArchived || !e.archived)
    .filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = MUSCLES.map((m) => [m, list.filter((e) => e.muscle === m).sort((a, b) => a.name.localeCompare(b.name))] as const).filter(([, l]) => l.length);

  const stats = (id: string) => {
    let last: string | null = null;
    let best: number | null = null;
    for (const w of workouts) {
      const sets = w.sets.filter((s) => s.exercise_id === id);
      if (!sets.length) continue;
      if (!last) last = w.started_at;
      const b = bestE1rm(sets, settings.e1rm_formula);
      if (b != null && (best == null || b > best)) best = b;
    }
    return { last, best };
  };

  return (
    <>
      <div className="page-head">
        <h1>Exercises</h1>
        <button className="link small" onClick={() => setCreating((c) => !c)}>{creating ? "Close" : "+ New exercise"}</button>
      </div>

      {creating && <NewExerciseForm initialName={q} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); onChanged(); }} />}

      {exercises.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>
          <p>Your exercise library is empty.</p>
          <p className="muted small">Add exercises one at a time, or start with {COMMON_EXERCISES.length} common lifts (squat, bench, deadlift, rows, presses and more) and edit from there.</p>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" onClick={addCommon} disabled={busy}>{busy ? "Adding…" : "Add common lifts"}</button>
        </div>
      ) : (
        <>
          <input className="input" type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" style={{ marginTop: 6 }} />
          {groups.map(([m, l]) => (
            <section key={m}>
              <h2 className="group-h">{MUSCLE_LABEL[m as Muscle]}</h2>
              <div className="panel list-panel">
                {l.map((e) => {
                  const s = stats(e.id);
                  return (
                    <button key={e.id} className="list-row" onClick={() => onOpen(e.id)}>
                      <span>
                        <strong>{e.name}</strong>{e.archived && <span className="chip" style={{ marginLeft: 6 }}>Archived</span>}
                        <span className="muted small" style={{ display: "block" }}>
                          {EQUIPMENT_LABEL[e.equipment]}{s.last ? `, last ${formatShort(new Date(s.last))}` : ", not logged yet"}
                        </span>
                      </span>
                      {s.best != null && <span className="num row-v">{fmtKg(Math.round(s.best))}<span className="muted small"> kg e1RM</span></span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No exercises match "{q}".</p>}
          <div style={{ marginTop: 18, display: "flex", gap: 16, flexWrap: "wrap" }}>
            {exercises.some((e) => e.archived) && <button className="link small" onClick={() => setShowArchived((s) => !s)}>{showArchived ? "Hide archived" : "Show archived"}</button>}
            {missingCommon.length > 0 && <button className="link small" onClick={addCommon} disabled={busy}>Add {missingCommon.length} common lifts you don't have</button>}
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </>
  );
}
