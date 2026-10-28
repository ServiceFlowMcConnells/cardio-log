import { useState } from "react";
import type { AppData } from "../App";
import type { Workout } from "../lib/strength";
import {
  trainingE1rm,
  EQUIPMENT_LABEL, MUSCLE_LABEL, REP_MAX_ROWS, RELIABLE_REPS, bestE1rm, e1rm, fmtKg, fmtTonnage, isWorking, loadFor,
  pctOf1rm, rirFromRpe, roundTo, volume,
} from "../lib/strength";
import { saveExercise } from "../lib/strengthData";
import { formatDay, formatShort } from "../lib/dates";
import { TrendChart, trendText, type Point } from "./Charts";
import { NewExerciseForm } from "./ExercisePicker";
import { STATUS_LABEL, STATUS_TONE, coachExercise, deloadActive } from "../lib/coach";
import { adjustmentFor, latestPhase, todaysCheckin } from "../lib/readiness";

const FORMULA_LABEL = { rpe: "RTS RPE chart", epley: "Epley formula", brzycki: "Brzycki formula" } as const;
const DAY = 86400000;

interface Props {
  exerciseId: string;
  data: AppData;
  onBack: () => void;
  onChanged: () => void;
  onOpenWorkout: (w: Workout) => void;
}

export default function ExerciseDetail({ exerciseId, data, onBack, onChanged, onOpenWorkout }: Props) {
  const { exercises, workouts, settings } = data;
  const ex = exercises.find((e) => e.id === exerciseId);
  const [editing, setEditing] = useState(false);
  const [calcReps, setCalcReps] = useState("5");
  const [calcRpe, setCalcRpe] = useState("8");
  const [estW, setEstW] = useState("");
  const [estR, setEstR] = useState("");
  const [estRpe, setEstRpe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const f = settings.e1rm_formula;
  const inc = exercises.find((e) => e.id === exerciseId)?.increment_kg ?? settings.weight_increment;

  if (!ex) {
    return <div className="empty"><p>Exercise not found.</p><button className="btn primary" onClick={onBack}>Back</button></div>;
  }

  // Sessions with this exercise, oldest first
  const sessions = workouts
    .map((w) => ({ w, sets: w.sets.filter((s) => s.exercise_id === exerciseId) }))
    .filter((x) => x.sets.length)
    .sort((a, b) => a.w.started_at.localeCompare(b.w.started_at));

  const e1rmPts: Point[] = [];
  const volPts: Point[] = [];
  for (const s of sessions) {
    const t = new Date(s.w.started_at).getTime();
    const b = bestE1rm(s.sets, f);
    if (b != null) e1rmPts.push({ t, v: b });
    const v = volume(s.sets);
    if (v > 0) volPts.push({ t, v });
  }
  const allBest = e1rmPts.length ? Math.max(...e1rmPts.map((p) => p.v)) : null;
  // Rep maxes and the calculator use your recent training e1RM (last session's average across working sets),
  // which is more conservative than the single best set.
  const training = trainingE1rm(exerciseId, workouts, new Date(Date.now() + DAY).toISOString(), f);
  const working1rm = training ?? allBest;
  const usingRecent = training != null;

  const allSets = sessions.flatMap((s) => s.sets.filter(isWorking).map((x) => ({ ...x, at: s.w.started_at })));
  const heaviest = allSets.reduce<null | (typeof allSets)[number]>((a, s) => (!a || s.weight_kg > a.weight_kg ? s : a), null);
  const bestVol = sessions.reduce<null | { v: number; at: string }>((a, s) => { const v = volume(s.sets); return !a || v > a.v ? { v, at: s.w.started_at } : a; }, null);
  // Best reps at each weight (rep records)
  const repRecords = new Map<number, { reps: number; at: string }>();
  for (const s of allSets) {
    const cur = repRecords.get(s.weight_kg);
    if (!cur || s.reps > cur.reps) repRecords.set(s.weight_kg, { reps: s.reps, at: s.at });
  }
  const repRows = [...repRecords.entries()].filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]).slice(0, 8);

  const cReps = Number(calcReps), cRpe = calcRpe.trim() ? Number(calcRpe) : null;
  const calcLoad = working1rm && cReps >= 1 ? loadFor(working1rm, cReps, cRpe, f) : null;
  const ew = Number(estW.replace(",", ".")), er = Number(estR), erpe = estRpe.trim() ? Number(estRpe.replace(",", ".")) : null;
  const est = ew > 0 && er >= 1 && Number.isInteger(er) && (erpe == null || (erpe >= 5 && erpe <= 10)) ? e1rm({ weight_kg: ew, reps: er, rpe: erpe, set_type: "working" }, f) : null;

  const trend = trendText(e1rmPts.slice(-8), "over your last sessions");

  async function toggleArchive() {
    setError(null);
    try { await saveExercise({ ...ex!, archived: !ex!.archived }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update."); }
  }

  return (
    <>
      <div className="editor-bar">
        <button className="btn ghost" onClick={onBack}>Back</button>
        <button className="btn ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</button>
      </div>
      {editing ? (
        <NewExerciseForm existing={ex} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      ) : (
        <>
          <h1>{ex.name}</h1>
          <p className="muted">{MUSCLE_LABEL[ex.muscle]}, {EQUIPMENT_LABEL[ex.equipment].toLowerCase()}{ex.archived ? " (archived)" : ""}</p>
          {ex.notes && <p className="small" style={{ marginTop: 6 }}>{ex.notes}</p>}
        </>
      )}

      {(() => {
        const today = todaysCheckin(data.checkins);
        const p = sessions.length ? coachExercise(ex, ex.id, null, workouts, data.templates, new Date(Date.now() + 1000).toISOString(),
          { formula: f, inc, adj: today ? adjustmentFor(today) : null, deload: deloadActive(settings.deload_until), phase: latestPhase(data.checkins) }) : null;
        if (!p) return null;
        const h = p.history;
        return (
          <div className={`coach-box tone-${STATUS_TONE[p.status]}`} style={{ marginTop: 14 }}>
            <div className="coach-top">
              <span className="coach-chip">{STATUS_LABEL[p.status]}</span>
              <strong className="coach-head">Next: {p.headline}</strong>
            </div>
            <p className="small">{p.why}</p>
            <p className="small muted" style={{ marginTop: 6 }}>
              Rep range {p.plan.rep_min}–{p.plan.rep_max}{p.plan.target_rpe ? ` @ RPE ${p.plan.target_rpe}` : ""}.
              {h.vsPeakPct != null && h.sessions.length > 1 ? ` Latest session ${h.vsPeakPct >= -0.5 ? "is at" : `is ${Math.abs(Math.round(h.vsPeakPct))}% below`} its 6-week best.` : ""}
              {h.stalled > 0 ? ` ${h.stalled} session${h.stalled === 1 ? "" : "s"} without a gain.` : ""}
            </p>
          </div>
        );
      })()}

      {sessions.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <p>No sets logged yet. Your estimated 1RM, rep maxes and trends appear after your first workout with this exercise.</p>
        </div>
      ) : (
        <>
          <div className="belt-wrap" style={{ marginTop: 16 }}>
            <div className="belt-figure">
              <span className="big">{working1rm ? fmtKg(Math.round(working1rm * 10) / 10) : "–"}</span>
              <span className="of">kg e1RM</span>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {usingRecent
                ? `Your last session's average across working sets, used for the tables and suggestions below. Best single set: ${fmtKg(Math.round(allBest! * 10) / 10)} kg. `
                : "From your best set (nothing in the last 8 weeks). "}
              Estimated with the {FORMULA_LABEL[f]}{f === "rpe" ? ", using the RPE you logged" : ""}. Change the method in Settings.
            </p>
            {trend && <p className={`trend ${trend.dir}`}>{trend.text}</p>}
          </div>

          {e1rmPts.length > 0 && (
            <section className="section panel">
              <h2>Estimated 1RM</h2>
              <TrendChart points={e1rmPts} color="var(--lift)" unit="kg" />
            </section>
          )}
          {volPts.length > 0 && (
            <section className="section panel">
              <h2>Volume per session</h2>
              <TrendChart points={volPts} color="var(--ink)" unit="kg" />
              <p className="chart-note">Weight × reps across working sets. Warm-ups aren't counted.</p>
            </section>
          )}

          {working1rm && (
            <section className="section panel">
              <h2>Rep maxes</h2>
              <p className="chart-note" style={{ marginTop: 2 }}>What you should manage for each rep count to failure, rounded down to {fmtKg(inc)} kg.</p>
              <table className="bench" style={{ marginTop: 8 }}>
                <thead><tr><th>Reps</th><th>%1RM</th><th>Weight</th></tr></thead>
                <tbody>
                  {REP_MAX_ROWS.map((r) => {
                    const p = pctOf1rm(r, 0, f);
                    if (!p) return null;
                    return (
                      <tr key={r} className={r > RELIABLE_REPS ? "muted" : undefined}>
                        <td>{r}RM</td>
                        <td>{Math.round(p * 1000) / 10}%</td>
                        <td>{fmtKg(roundTo(working1rm * p, inc, "down"))} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="chart-note">Above {RELIABLE_REPS} reps the estimates get less reliable.</p>
            </section>
          )}

          {working1rm && (
            <section className="section panel">
              <h2>Load calculator</h2>
              <p className="chart-note" style={{ marginTop: 2 }}>Pick reps and how hard it should feel. RPE 8 means about 2 reps left in the tank.</p>
              <div className="grid c2" style={{ marginTop: 10 }}>
                <label className="field"><span>Reps</span><input className="input" inputMode="numeric" value={calcReps} onChange={(e) => setCalcReps(e.target.value)} /></label>
                <label className="field"><span>RPE</span><input className="input" inputMode="decimal" value={calcRpe} onChange={(e) => setCalcRpe(e.target.value)} placeholder="10" /></label>
              </div>
              <p className="calc-out">
                {calcLoad
                  ? <>Use <strong>{fmtKg(roundTo(calcLoad, inc, "down"))} kg</strong> <span className="muted small">({Math.round((calcLoad / working1rm) * 100)}% of 1RM, {rirFromRpe(cRpe)} rep{rirFromRpe(cRpe) === 1 ? "" : "s"} in reserve)</span></>
                  : <span className="muted small">Enter 1–20 reps and an RPE from 5 to 10.</span>}
              </p>
            </section>
          )}
        </>
      )}

      <section className="section panel">
        <h2>Estimate a 1RM from a set</h2>
        <div className="grid c3" style={{ marginTop: 10 }}>
          <label className="field"><span>kg</span><input className="input" inputMode="decimal" value={estW} onChange={(e) => setEstW(e.target.value)} /></label>
          <label className="field"><span>Reps</span><input className="input" inputMode="numeric" value={estR} onChange={(e) => setEstR(e.target.value)} /></label>
          <label className="field"><span>RPE</span><input className="input" inputMode="decimal" value={estRpe} placeholder="10" onChange={(e) => setEstRpe(e.target.value)} /></label>
        </div>
        <p className="calc-out">
          {est ? <>Estimated 1RM <strong>{fmtKg(Math.round(est * 10) / 10)} kg</strong>{er > RELIABLE_REPS ? <span className="muted small"> (rough above {RELIABLE_REPS} reps)</span> : null}</> : <span className="muted small">Enter a weight and reps (up to 20).</span>}
        </p>
      </section>

      {sessions.length > 0 && (
        <section className="section">
          <h2>Records</h2>
          <div className="records">
            {allBest && <div className="stat"><div className="v">{fmtKg(Math.round(allBest * 10) / 10)} kg</div><div className="l">Best estimated 1RM</div></div>}
            {heaviest && <div className="stat"><div className="v">{fmtKg(heaviest.weight_kg)} kg</div><div className="l">Heaviest, {heaviest.reps} rep{heaviest.reps === 1 ? "" : "s"}, {formatShort(new Date(heaviest.at))}</div></div>}
            {bestVol && bestVol.v > 0 && <div className="stat"><div className="v">{fmtTonnage(bestVol.v)}</div><div className="l">Best session volume, {formatShort(new Date(bestVol.at))}</div></div>}
            <div className="stat"><div className="v">{sessions.length}</div><div className="l">sessions logged</div></div>
          </div>
          {repRows.length > 1 && (
            <div className="panel" style={{ marginTop: 8 }}>
              <h3>Best reps at each weight</h3>
              <table className="bench" style={{ marginTop: 6 }}>
                <thead><tr><th>Weight</th><th>Reps</th><th>Date</th></tr></thead>
                <tbody>{repRows.map(([w, r]) => <tr key={w}><td>{fmtKg(w)} kg</td><td>{r.reps}</td><td>{formatShort(new Date(r.at))}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {sessions.length > 0 && (
        <section className="section">
          <h2>History</h2>
          {[...sessions].reverse().slice(0, 12).map(({ w, sets }) => (
            <button key={w.id} className="session-card" onClick={() => onOpenWorkout(w)}>
              <div className="top">
                <span className="when">{formatDay(new Date(w.started_at))} <span className="muted small">{w.name}</span></span>
                <span className="mins">{fmtTonnage(volume(sets))}</span>
              </div>
              <p className="small" style={{ marginTop: 4 }}>
                {sets.map((s) => `${s.set_type === "warmup" ? "W " : ""}${fmtKg(s.weight_kg)}×${s.reps}${s.rpe ? `@${s.rpe}` : ""}`).join("  ")}
              </p>
            </button>
          ))}
        </section>
      )}

      <div style={{ marginTop: 24 }}>
        {error && <p className="error">{error}</p>}
        <button className="btn ghost block" onClick={toggleArchive}>{ex.archived ? "Restore exercise" : "Archive exercise"}</button>
        <p className="muted small" style={{ marginTop: 6 }}>Archiving hides it from the picker but keeps its history.</p>
      </div>
    </>
  );
}
