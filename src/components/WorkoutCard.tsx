import { useMemo } from "react";
import type { E1rmFormula, Exercise, Workout } from "../lib/strength";
import { PR_LABEL, fmtKg, isWorking, setsByExercise, workoutIntensity, workoutPrs } from "../lib/strength";
import { formatDay, formatTime } from "../lib/dates";

interface Props { workout: Workout; exercises: Exercise[]; workouts: Workout[]; formula: E1rmFormula; onOpen: (w: Workout) => void }

export default function WorkoutCard({ workout: w, exercises, workouts, formula, onOpen }: Props) {
  const intensity = useMemo(() => workoutIntensity(w, workouts, formula), [w, workouts, formula]);
  const prs = useMemo(() => workoutPrs(w, workouts, formula), [w, workouts, formula]);
  const names = new Map(exercises.map((e) => [e.id, e.name]));
  const d = new Date(w.started_at);
  const groups = [...setsByExercise(w).entries()];
  return (
    <button className="session-card lift-card" onClick={() => onOpen(w)}>
      <div className="top">
        <span className="when">
          {w.name} <span className="muted small">{formatDay(d)}, {formatTime(d)}</span>
        </span>
        {intensity != null && (
          <span className="mins intensity" title="Average intensity: mean weight as a % of your estimated 1RM going in">
            {Math.round(intensity * 100)}%<span className="l">avg intensity</span>
          </span>
        )}
      </div>
      {groups.map(([id, sets]) => {
        const work = sets.filter(isWorking);
        const top = work.reduce<null | (typeof work)[number]>((a, s) => (!a || s.weight_kg > a.weight_kg || (s.weight_kg === a.weight_kg && s.reps > a.reps) ? s : a), null);
        return (
          <div className="block-line" key={id}>
            <span>
              <span className="dot lift" aria-hidden="true" style={{ marginRight: 8 }} />
              {work.length} × {names.get(id) ?? "Exercise"}
              {top && <span className="muted">, best {top.weight_kg > 0 ? `${fmtKg(top.weight_kg)} kg × ${top.reps}` : `${top.reps} reps`}</span>}
              {prs.byExercise.has(id) && (
                <span className="pr-mark" title={`PR: ${prs.byExercise.get(id)!.map((k) => PR_LABEL[k]).join(", ")}`}>
                  <Trophy /> {prs.byExercise.get(id)!.length}
                </span>
              )}
            </span>
          </div>
        );
      })}
      {(w.duration_min != null || prs.count > 0) && (
        <p className="card-foot small">
          {w.duration_min != null && <span className="muted">{Math.round(w.duration_min)} min</span>}
          {prs.count > 0 && <span className="pr-count"><Trophy /> {prs.count} PR{prs.count === 1 ? "" : "s"}</span>}
        </p>
      )}
    </button>
  );
}

function Trophy() {
  return (
    <svg className="trophy" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.35A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.35 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.73V7Zm10 0v2.73A2 2 0 0 0 18 8V7h-1Z" />
    </svg>
  );
}
