import { weekHasDeload } from "../lib/deload";
import { weekHasIllness } from "../lib/illness";
import type { AppData } from "../App";
import type { Muscle, Workout } from "../lib/strength";
import { MUSCLE_LABEL, fmtTonnage, hardSetsByMuscle, volume } from "../lib/strength";
import { addDays, startOfWeek, weekKey } from "../lib/dates";
import { WeeklyBars } from "./Charts";
import StrengthReport from "./StrengthReport";
import ExerciseDetail from "./ExerciseDetail";
import { useState } from "react";
import { rangeWeeks, useDeskRange } from "../lib/deskRange";
import { useDesktop } from "../lib/desktop";
import Note from "./Note";

// Common evidence-based range for weekly hard sets per muscle for growth (e.g. Schoenfeld et al.; RP volume landmarks).
const SETS_LOW = 10;
const SETS_HIGH = 20;

export default function StrengthProgress({ data, onLog, onOpenExercise, onChanged, onOpenWorkout }: { data: AppData; onLog: () => void; onOpenExercise: (id: string) => void; onChanged?: () => void; onOpenWorkout?: (w: Workout) => void }) {
  const desktop = useDesktop();
  const desk = useDeskRange();
  const [selLift, setSelLift] = useState<string | null>(null);
  const { workouts, exercises } = data;

  if (workouts.length === 0) {
    return (
      <div className="empty">
        <p>Your strength trends appear here once you've logged a workout: weekly volume, sets per muscle, and estimated 1RM for every lift.</p>
        <button className="btn primary" onClick={onLog}>Train</button>
      </div>
    );
  }

  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const cur = startOfWeek(new Date());
  const weeks: { start: Date; value: number; list: Workout[] }[] = [];
  const histWeeks = workouts.length ? Math.ceil((Date.now() - new Date(workouts[workouts.length - 1].started_at).getTime()) / (7 * 86400000)) + 1 : 12;
  const nWeeks = desk ? Math.max(5, Math.min(104, rangeWeeks(desk.range) ?? histWeeks)) : 12;
  for (let i = nWeeks - 1; i >= 0; i--) {
    const start = addDays(cur, -7 * i);
    const k = weekKey(start);
    const list = workouts.filter((w) => weekKey(new Date(w.started_at)) === k);
    weeks.push({ start, value: list.reduce((a, w) => a + volume(w.sets), 0), list });
  }
  const thisWeek = weeks[weeks.length - 1];
  const prev4 = weeks.slice(-5, -1);
  const prev4Active = prev4.filter((w) => w.list.length);

  const setsNow = hardSetsByMuscle(thisWeek.list, exMap);
  const setsAvg = new Map<Muscle, number>();
  for (const w of prev4Active) for (const [m, n] of hardSetsByMuscle(w.list, exMap)) setsAvg.set(m, (setsAvg.get(m) ?? 0) + n / prev4Active.length);
  const muscles = (Object.keys(MUSCLE_LABEL) as Muscle[]).filter((m) => (setsNow.get(m) ?? 0) > 0 || (setsAvg.get(m) ?? 0) > 0);
  const maxSets = Math.max(SETS_HIGH + 4, ...muscles.map((m) => Math.max(setsNow.get(m) ?? 0, setsAvg.get(m) ?? 0)));


  const lastFull = weeks[weeks.length - 2];
  const volumeEl = (
      <section className="panel prog-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2>Weekly volume</h2>
          <span className="muted small">Last {nWeeks} weeks</span>
        </div>
        <WeeklyBars weeks={weeks} unit="kg" format={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}t` : String(Math.round(v)))} deload={weekHasDeload} ill={weekHasIllness} />
        <Note>
          Weight × reps over working sets. This week so far: {fmtTonnage(thisWeek.value)}
          {lastFull.value > 0 ? `, last week ${fmtTonnage(lastFull.value)}` : ""}.
          {weeks.some((w) => weekHasDeload(w.start)) && <> <span className="deload-key">Deload weeks</span> are shaded and marked D.</>}
        </Note>
      </section>
  );
  const setsEl = (
      <section className="section panel prog-card">
        <h2>Hard sets per muscle</h2>
        <Note style={{ marginTop: 2 }}>
          Working sets at RPE 7 or harder (or with no RPE logged). Each set counts in full for the exercise's main muscle and half for muscles that help (triceps on bench, glutes on squats), the counting that best predicts growth. The shaded band is {SETS_LOW}–{SETS_HIGH} sets a week, a common evidence-based range for muscle growth. In a calorie deficit, holding volume steady is a good result.
        </Note>
        {muscles.length === 0 ? (
          <p className="muted small" style={{ marginTop: 8 }}>No working sets in the last 5 weeks.</p>
        ) : (
          <div className="msets">
            {muscles.map((m) => {
              const n = setsNow.get(m) ?? 0;
              const avg = setsAvg.get(m);
              return (
                <div className="mset" key={m}>
                  <span className="mlabel">{MUSCLE_LABEL[m]}</span>
                  <div className="mtrack" aria-label={`${MUSCLE_LABEL[m]}: ${Math.round(n * 2) / 2} sets this week${avg != null ? `, ${Math.round(avg)} a week on average before` : ""}`}>
                    <div className="mband" style={{ left: `${(SETS_LOW / maxSets) * 100}%`, width: `${((SETS_HIGH - SETS_LOW) / maxSets) * 100}%` }} />
                    <div className="mbar" style={{ width: `${(n / maxSets) * 100}%` }} />
                    {avg != null && avg > 0 && <div className="mavg" style={{ left: `${(avg / maxSets) * 100}%` }} title="4-week average" />}
                  </div>
                  <span className="num mnum">{Math.round(n * 2) / 2}</span>
                </div>
              );
            })}
            {weekHasDeload(weeks[weeks.length - 1].start) && <p className="small muted" style={{ margin: "4px 0 0" }}>This is a deload week, so fewer hard sets is the plan.</p>}
            <p className="legend"><span><i className="dot lift" /> This week</span><span><i className="tickmark" /> Average of previous 4 weeks</span></p>
          </div>
        )}
      </section>
  );
  if (desktop) {
    const sel = selLift && exercises.some((e) => e.id === selLift) ? selLift : null;
    return (
      <div className="sp-desk">
        <div className="sp-left"><StrengthReport data={data} selected={sel} onOpenExercise={(id) => setSelLift((c) => (c === id ? null : id))} /></div>
        <div className="sp-right">
          {sel ? (
            <div className="panel detail-panel">
              <ExerciseDetail key={sel} exerciseId={sel} data={data} onBack={() => setSelLift(null)} onChanged={onChanged ?? (() => undefined)} onOpenWorkout={onOpenWorkout ?? (() => undefined)} />
            </div>
          ) : (
            <>
              <p className="small muted sp-hint">Click a lift in the report to open its chart, rep maxes and sessions here.</p>
              {volumeEl}
              {setsEl}
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      <StrengthReport data={data} onOpenExercise={onOpenExercise} />
      {volumeEl}
      {setsEl}

    </>
  );
}
