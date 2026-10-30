import { useMemo } from "react";
import type { E1rmFormula, Exercise, Workout } from "../lib/strength";
import { fmtKg, isWorking, setsByExercise, workoutIntensity } from "../lib/strength";
import { formatDay, formatTime } from "../lib/dates";

interface Props { workout: Workout; exercises: Exercise[]; workouts: Workout[]; formula: E1rmFormula; onOpen: (w: Workout) => void }

export default function WorkoutCard({ workout: w, exercises, workouts, formula, onOpen }: Props) {
  const intensity = useMemo(() => workoutIntensity(w, workouts, formula), [w, workouts, formula]);
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
              {top && <span className="muted">, best {fmtKg(top.weight_kg)} kg × {top.reps}</span>}
            </span>
          </div>
        );
      })}
      {w.duration_min != null && <p className="muted small" style={{ marginTop: 6 }}>{Math.round(w.duration_min)} min</p>}
    </button>
  );
}
