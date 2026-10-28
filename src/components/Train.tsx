import type { AppData } from "../App";
import type { Template } from "../lib/strength";
import { formatDay } from "../lib/dates";
import { readWorkoutDraft } from "./WorkoutLogger";
import CoachPanel from "./CoachPanel";

interface Props {
  data: AppData;
  onLogCardio: () => void;
  onStart: (t: Template | null) => void;
  onResume: () => void;
  onEditTemplate: (t: Template | null) => void;
  onChanged: () => void;
  onOpenExercise: (id: string) => void;
}

export default function Train({ data, onLogCardio, onStart, onResume, onEditTemplate, onChanged, onOpenExercise }: Props) {
  const { templates, exercises, workouts } = data;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const draft = readWorkoutDraft();

  return (
    <>
      <div className="page-head"><h1>Train</h1></div>

      {draft && (
        <button className="resume" onClick={onResume}>
          <span>
            <strong>Workout in progress: {draft.name}</strong>
            <span className="small" style={{ display: "block" }}>
              Started {new Date(draft.started_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}. Tap to carry on.
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}

      <div className="grid c2">
        <button className="btn primary" onClick={() => (draft ? onResume() : onStart(null))}>Empty workout</button>
        <button className="btn" onClick={onLogCardio}><i className="dot treadmill" /> Log cardio</button>
      </div>

      <CoachPanel data={data} onOpenExercise={onOpenExercise} onChanged={onChanged} />

      <section className="section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>Templates</h2>
          <button className="link small" onClick={() => onEditTemplate(null)}>+ New template</button>
        </div>
        {templates.length === 0 ? (
          <div className="empty">
            <p>Templates are your planned workouts: exercises with sets × reps and a target effort.</p>
            <button className="btn primary" onClick={() => onEditTemplate(null)}>Create a template</button>
          </div>
        ) : (
          templates.map((t) => {
            const last = workouts.find((w) => w.template_id === t.id);
            return (
              <div className="tpl" key={t.id}>
                <div className="tpl-head">
                  <h3>{t.name}</h3>
                  <button className="link small" onClick={() => onEditTemplate(t)}>Edit</button>
                </div>
                <ul className="tpl-list">
                  {t.exercises.map((e, i) => (
                    <li key={i}>
                      {e.sets} × {e.rep_min === e.rep_max ? e.rep_min : `${e.rep_min}–${e.rep_max}`} {exMap.get(e.exercise_id)?.name ?? "Exercise"}
                      {e.target_rpe ? <span className="muted"> @ RPE {e.target_rpe}</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="tpl-foot">
                  <span className="muted small">{last ? `Last done ${formatDay(new Date(last.started_at))}` : "Not done yet"}</span>
                  <button className="btn dark" onClick={() => onStart(t)} disabled={Boolean(draft)} title={draft ? "Finish or discard the workout in progress first" : undefined}>
                    Start
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
