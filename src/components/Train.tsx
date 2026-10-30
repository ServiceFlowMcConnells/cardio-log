import type { AppData } from "../App";
import type { Template } from "../lib/strength";
import { formatDay } from "../lib/dates";
import { readWorkoutDraft } from "./WorkoutLogger";
import CoachPanel from "./CoachPanel";
import { daysThisWeek, doneToday } from "../lib/mobility";
import ProgramsSection from "./ProgramsSection";
import { useDesktop } from "../lib/desktop";
import type { Program } from "../lib/programs";

interface Props {
  data: AppData;
  onLogCardio: () => void;
  onStart: (t: Template | null) => void;
  onResume: () => void;
  onEditTemplate: (t: Template | null) => void;
  onChanged: () => void;
  onOpenExercise: (id: string) => void;
  onWarmup: (t: Template) => void;
  onMobility: () => void;
  onDailyMobility: () => void;
  onEditProgram: (p: Program | null) => void;
  onPlan: () => void;
}

export default function Train({ data, onLogCardio, onStart, onResume, onEditTemplate, onChanged, onOpenExercise, onWarmup, onMobility, onDailyMobility, onEditProgram, onPlan }: Props) {
  const { templates, exercises, workouts } = data;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const desktop = useDesktop();
  const draft = desktop ? null : readWorkoutDraft();

  return (
    <>
      <div className="page-head"><h1>{desktop ? "Programs & templates" : "Train"}</h1></div>

      <div className="cols">
      <div className="col">
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

      <ProgramsSection data={data} busyDraft={Boolean(draft)} onStart={onStart} onWarmup={onWarmup} onEdit={onEditProgram} onChanged={onChanged} />
      {data.templates.length > 0 && <button className="btn block" style={{ marginTop: 10 }} onClick={onPlan}>Plan my week</button>}

      {!desktop && <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => (draft ? onResume() : onStart(null))}>Start an empty workout</button>}

      <section className="section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>{data.programs.length ? "All templates" : "Templates"}</h2>
          <button className="link small" onClick={() => onEditTemplate(null)}>+ New template</button>
        </div>
        {templates.length === 0 ? (
          <div className="empty">
            <p>Templates are your planned workouts: exercises with sets × reps and a target effort.</p>
            <button className="btn primary" onClick={() => onEditTemplate(null)}>Create a template</button>
          </div>
        ) : (
          <div className="tpl-grid">{templates.map((t) => {
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
                  {desktop ? null : (
                  <span className="tpl-btns">
                    <button className="btn ghost" onClick={() => onWarmup(t)} disabled={Boolean(draft)} title="5-minute mobility warm-up, then start">Warm-up</button>
                    <button className="btn dark" onClick={() => onStart(t)} disabled={Boolean(draft)} title={draft ? "Finish or discard the workout in progress first" : undefined}>
                      Start
                    </button>
                  </span>
                  )}
                </div>
              </div>
            );
          })}</div>
        )}
      </section>

      </div>
      <div className="col">
      <CoachPanel data={data} onOpenExercise={onOpenExercise} onChanged={onChanged} />

      <section className="section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>Mobility</h2>
          <button className="link small" onClick={onMobility}>Screen, niggles, history ›</button>
        </div>
        <div className="grid c2">
          <button className="btn block" onClick={onDailyMobility}>{doneToday(data.mobilitySessions) ? "10-min routine again" : "10-min routine"}</button>
          <button className="btn block" onClick={onMobility}>{data.mobilityTests.length ? `Score ${data.mobilityTests[0].score}` : "Take the screen"}</button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>{daysThisWeek(data.mobilitySessions)} day{daysThisWeek(data.mobilitySessions) === 1 ? "" : "s"} in the last 7. Use Warm-up on a template for a 5-minute session aimed at that workout.</p>
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 10 }}>Cardio</h2>
        <button className="btn block" onClick={onLogCardio}><i className="dot treadmill" /> Log a cardio session</button>
      </section>
      </div>
      </div>
    </>
  );
}
