import type { Exercise, Workout } from "../lib/strength";
import { fmtKg, fmtTonnage, isWorking, setsByExercise, volume } from "../lib/strength";
import { formatDay, formatTime } from "../lib/dates";

export default function WorkoutCard({ workout: w, exercises, onOpen }: { workout: Workout; exercises: Exercise[]; onOpen: (w: Workout) => void }) {
  const names = new Map(exercises.map((e) => [e.id, e.name]));
  const d = new Date(w.started_at);
  const groups = [...setsByExercise(w).entries()];
  return (
    <button className="session-card lift-card" onClick={() => onOpen(w)}>
      <div className="top">
        <span className="when">
          {w.name} <span className="muted small">{formatDay(d)}, {formatTime(d)}</span>
        </span>
        <span className="mins">{fmtTonnage(volume(w.sets))}</span>
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
