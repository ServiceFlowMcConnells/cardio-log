import { useState } from "react";
import type { AppData } from "../App";
import type { Template } from "../lib/strength";
import type { Program } from "../lib/programs";
import { advance, liveSteps, nextInProgram, setActiveProgram, setNextStep } from "../lib/programs";
import { formatDay } from "../lib/dates";
import { useDesktop } from "../lib/desktop";

interface Props {
  data: AppData;
  busyDraft: boolean;
  onStart: (t: Template) => void;
  onWarmup: (t: Template) => void;
  onEdit: (p: Program | null) => void;
  onChanged: () => void;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export default function ProgramsSection({ data, busyDraft, onStart, onWarmup, onEdit, onChanged }: Props) {
  const { programs, templates, workouts, exercises } = data;
  const desktop = useDesktop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = programs.find((p) => p.id === data.activeProgramId) ?? null;
  const others = programs.filter((p) => p !== active);
  const exName = new Map(exercises.map((e) => [e.id, e.name]));

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await f(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update."); } finally { setBusy(false); }
  }

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Program</h2>
        <button className="link small" onClick={() => onEdit(null)}>+ New program</button>
      </div>

      {!programs.length ? (
        <button className="mob-cta prog-cta" onClick={() => onEdit(null)} disabled={!templates.length}>
          <strong>Group templates into a program</strong>
          <span className="small">{templates.length ? "e.g. Hypertrophy A and B. The active program alternates them for you: Next up always shows the next one in the rotation." : "Create your workout templates first, then put them in a rotation."}</span>
          <span aria-hidden="true" className="mob-cta-arrow">›</span>
        </button>
      ) : active ? (() => {
        const steps = liveSteps(active, templates);
        const next = nextInProgram(active, templates);
        const done = workouts.filter((w) => w.program_id === active.id);
        return (
          <div className="tpl prog-card">
            <div className="tpl-head">
              <h3>{active.name}</h3>
              <span className="chip prog-active">Active</span>
            </div>
            <div className="prog-steps" aria-label="Rotation">
              {steps.map((s) => (
                <span key={s.index} className={`prog-chip${next?.index === s.index ? " next" : ""}`}>
                  <b>{letter(s.index)}</b> {s.template.name}
                </span>
              ))}
            </div>
            {next ? (
              <>
                <p className="small" style={{ marginTop: 10 }}><strong>Next: {next.template.name}</strong></p>
                <ul className="tpl-list">
                  {next.template.exercises.map((e, i) => (
                    <li key={i}>{e.sets} × {e.rep_min === e.rep_max ? e.rep_min : `${e.rep_min}–${e.rep_max}`} {exName.get(e.exercise_id) ?? "Exercise"}{e.target_rpe ? <span className="muted"> @ RPE {e.target_rpe}</span> : null}</li>
                  ))}
                </ul>
                <div className="tpl-foot">
                  <span className="muted small">{done.length ? `${done.length} done · last ${formatDay(new Date(done[0].started_at))}` : "Not started yet"}</span>
                  {!desktop && (
                  <span className="tpl-btns">
                    <button className="btn ghost" onClick={() => onWarmup(next.template)} disabled={busyDraft}>Warm-up</button>
                    <button className="btn primary" onClick={() => onStart(next.template)} disabled={busyDraft} title={busyDraft ? "Finish or discard the workout in progress first" : undefined}>Start</button>
                  </span>
                  )}
                </div>
                <div className="prog-links">
                  <button className="link small" disabled={busy} onClick={() => run(() => setNextStep(active.id, advance(active, next.index)))}>Skip to {steps.find((s) => s.index === advance(active, next.index))?.template.name ?? "next"}</button>
                  <button className="link small" onClick={() => onEdit(active)}>Edit</button>
                  <button className="link small" disabled={busy} onClick={() => run(() => setActiveProgram(null))}>Stop program</button>
                </div>
              </>
            ) : (
              <p className="small" style={{ marginTop: 8 }}>This program has no workouts left (their templates were deleted). <button className="link small" onClick={() => onEdit(active)}>Edit it</button></p>
            )}
          </div>
        );
      })() : (
        <p className="muted small">No active program, so Next up picks the template you've gone longest without.</p>
      )}

      {others.length > 0 && (
        <div className="panel list-panel" style={{ marginTop: 10 }}>
          {others.map((p) => (
            <div key={p.id} className="list-row static">
              <span style={{ minWidth: 0 }}>
                <strong>{p.name}</strong>
                <span className="small muted" style={{ display: "block" }}>{liveSteps(p, templates).map((s) => s.template.name).join(" → ") || "No workouts"}</span>
              </span>
              <span className="prog-row-btns">
                <button className="link small" onClick={() => onEdit(p)}>Edit</button>
                <button className="btn ghost" disabled={busy || !liveSteps(p, templates).length} onClick={() => run(() => setActiveProgram(p.id))}>Set active</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
