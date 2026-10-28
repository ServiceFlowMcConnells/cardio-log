import type { AppData } from "../App";
import type { Workout } from "../lib/strength";
import { SET_TYPE_LABEL, compareWorkout, e1rm, fmtKg, fmtTonnage, pctChange } from "../lib/strength";
import { formatDay, formatTime } from "../lib/dates";
import { Delta } from "./WorkoutLogger";
import { BAND_LABEL, adjustmentFor, bandFor } from "../lib/readiness";
import { STATUS_LABEL, STATUS_TONE, coachExercise, deloadActive, verdict } from "../lib/coach";

interface Props {
  workoutId: string;
  data: AppData;
  onDone: () => void;
  onEdit: (w: Workout) => void;
}

export default function WorkoutSummary({ workoutId, data, onDone, onEdit }: Props) {
  const { workouts, exercises, settings } = data;
  const w = workouts.find((x) => x.id === workoutId);
  if (!w) {
    return (
      <div className="empty">
        <p>That workout couldn't be found. It may have been deleted.</p>
        <button className="btn primary" onClick={onDone}>Back</button>
      </div>
    );
  }
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const checkin = w.checkin_id ? data.checkins.find((x) => x.id === w.checkin_id) ?? null : null;
  const c = compareWorkout(w, workouts, settings.e1rm_formula);
  const tpl = data.templates.find((t) => t.id === w.template_id);
  const coachOpts = { formula: settings.e1rm_formula, inc: settings.weight_increment };
  const planOf = (id: string) => {
    const te = tpl?.exercises.find((x) => x.exercise_id === id);
    return te ? { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg } : null;
  };
  // What the coach asked for going into this workout, and what it wants next time
  const coachFor = (id: string) => {
    const before = coachExercise(exMap.get(id), id, planOf(id), workouts, data.templates, w.started_at,
      { ...coachOpts, adj: checkin ? adjustmentFor(checkin) : null, deload: false, excludeId: w.id });
    const next = coachExercise(exMap.get(id), id, planOf(id), workouts, data.templates, new Date(Date.now() + 1000).toISOString(),
      { ...coachOpts, adj: null, deload: deloadActive(settings.deload_until) });
    const isLatest = workouts.filter((x) => x.sets.some((s) => s.exercise_id === id))[0]?.id === w.id;
    return { before, next: isLatest ? next : null };
  };
  const d = new Date(w.started_at);
  const prs = c.exercises.flatMap((e) => e.prs.map((p) => ({ ex: exMap.get(e.exerciseId)?.name ?? "Exercise", p })));
  const intPts = c.intensity != null && c.prevIntensity != null ? (c.intensity - c.prevIntensity) * 100 : null;

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>{w.name}</h1>
          <p className="muted small">
            {formatDay(d)}, {formatTime(d)}{w.duration_min != null ? `, ${Math.round(w.duration_min)} min` : ""}
          </p>
          {checkin && <p className="small" style={{ marginTop: 4 }}><span className={`ready-score xs band-${bandFor(checkin.score)}`}>{checkin.score}</span> Readiness: {BAND_LABEL[bandFor(checkin.score)].toLowerCase()}</p>}
        </div>
        <button className="btn ghost" onClick={() => onEdit(w)}>Edit</button>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="stat">
          <div className="v">{fmtTonnage(c.volume)}</div>
          <div className="l">volume {c.prevVolume != null && <Delta v={pctChange(c.volume, c.prevVolume)} />}</div>
        </div>
        <div className="stat">
          <div className="v">{c.intensity != null ? `${Math.round(c.intensity * 100)}%` : "–"}</div>
          <div className="l">avg intensity (%1RM) {intPts != null && <Delta v={intPts} unit=" pts" />}</div>
        </div>
        <div className="stat">
          <div className="v">{c.workingSets}</div>
          <div className="l">working sets</div>
        </div>
        <div className="stat">
          <div className="v">{prs.length}</div>
          <div className="l">personal record{prs.length === 1 ? "" : "s"}</div>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        {c.previous
          ? `Compared with ${c.previous.name} on ${formatDay(new Date(c.previous.started_at))}. Intensity uses your best estimated 1RM going into this workout, so both sessions are measured the same way.`
          : "First time logging this workout. Next time you'll see volume and intensity against this one."}
      </p>

      {prs.length > 0 && (
        <section className="section">
          <h2>Personal records</h2>
          <div className="panel">
            {prs.map((x, i) => (
              <div key={i} className="pr-row">
                <span className="chip bench">PR</span> <strong>{x.ex}</strong> <span className="muted">{x.p}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Exercises</h2>
        <div className="stack">
          {c.exercises.map((e) => {
            const info = exMap.get(e.exerciseId);
            return (
              <div className="panel" key={e.exerciseId}>
                <h3>{info?.name ?? "Exercise"}</h3>
                <table className="bench" style={{ marginTop: 6 }}>
                  <thead>
                    <tr><th>Set</th><th>kg × reps</th><th>%1RM</th><th>e1RM</th></tr>
                  </thead>
                  <tbody>
                    {(() => { let n = 0; return e.sets.map((s, i) => {
                      const est = e1rm(s, settings.e1rm_formula);
                      const label = s.set_type === "warmup" ? "W" : `${++n}${s.set_type === "drop" ? " D" : s.set_type === "failure" ? " F" : ""}`;
                      return (
                        <tr key={i} className={s.set_type === "warmup" ? "muted" : undefined}>
                          <td title={SET_TYPE_LABEL[s.set_type]}>{label}</td>
                          <td>{fmtKg(s.weight_kg)} × {s.reps}{s.rpe ? ` @${s.rpe}` : ""}</td>
                          <td>{e.reference && s.weight_kg > 0 && s.set_type !== "warmup" ? `${Math.round((s.weight_kg / e.reference) * 100)}%` : "–"}</td>
                          <td>{est ? fmtKg(Math.round(est * 10) / 10) : "–"}</td>
                        </tr>
                      );
                    }); })()}
                  </tbody>
                </table>
                <div className="lift-stats">
                  <span>Volume <strong>{fmtTonnage(e.volume)}</strong>{e.prevVolume ? <Delta v={pctChange(e.volume, e.prevVolume)} /> : null}</span>
                  {e.topE1rm != null && <span>Top e1RM <strong>{fmtKg(Math.round(e.topE1rm * 10) / 10)} kg</strong>{e.prevTopE1rm ? <Delta v={pctChange(e.topE1rm, e.prevTopE1rm)} /> : null}</span>}
                  {e.intensity != null && (
                    <span>Intensity <strong>{Math.round(e.intensity * 100)}%</strong>
                      {e.prevIntensity != null && <Delta v={(e.intensity - e.prevIntensity) * 100} unit=" pts" />}
                    </span>
                  )}
                </div>
                {e.prs.length > 0 && <p className="small" style={{ marginTop: 6 }}><span className="chip bench">PR</span> {e.prs.join(", ")}</p>}
                {(() => {
                  const { before, next } = coachFor(e.exerciseId);
                  const v = before && before.status !== "new" ? verdict(before, e.sets) : null;
                  if (!v?.text && !next) return null;
                  return (
                    <div className="coach-verdict">
                      {v?.text && before && (
                        <p className="small"><span className={`coach-chip tone-${v.hit ? "good" : "warn"}`}>{v.hit ? "On target" : "Short"}</span> Coach asked for {before.headline}. {v.text}</p>
                      )}
                      {next && (
                        <p className="small" style={{ marginTop: 4 }}><span className={`coach-chip tone-${STATUS_TONE[next.status]}`}>{STATUS_LABEL[next.status]}</span> Next time: <strong>{next.headline}</strong></p>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </section>

      {w.notes && <p className="panel" style={{ marginTop: 14 }}>{w.notes}</p>}

      <button className="btn primary block" style={{ marginTop: 18 }} onClick={onDone}>Done</button>
    </>
  );
}
