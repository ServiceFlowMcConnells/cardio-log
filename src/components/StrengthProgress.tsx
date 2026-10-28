import type { AppData } from "../App";
import type { Muscle, Workout } from "../lib/strength";
import { MUSCLE_LABEL, bestE1rm, fmtKg, fmtTonnage, hardSetsByMuscle, pctChange, volume } from "../lib/strength";
import { addDays, startOfWeek, weekKey } from "../lib/dates";
import { WeeklyBars } from "./Charts";
import { Delta } from "./WorkoutLogger";

const DAY = 86400000;
// Common evidence-based range for weekly hard sets per muscle for growth (e.g. Schoenfeld et al.; RP volume landmarks).
const SETS_LOW = 10;
const SETS_HIGH = 20;

export default function StrengthProgress({ data, onLog, onOpenExercise }: { data: AppData; onLog: () => void; onOpenExercise: (id: string) => void }) {
  const { workouts, exercises, settings } = data;
  const f = settings.e1rm_formula;

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
  for (let i = 11; i >= 0; i--) {
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

  // Per lift: best e1RM in the last 4 weeks vs the 4 weeks before
  const now = Date.now();
  const lifts = exercises
    .map((e) => {
      const done = workouts.filter((w) => w.sets.some((s) => s.exercise_id === e.id));
      if (!done.length) return null;
      const best = (from: number, to: number) => {
        let b: number | null = null;
        for (const w of done) {
          const t = new Date(w.started_at).getTime();
          if (t < from || t >= to) continue;
          const v = bestE1rm(w.sets.filter((s) => s.exercise_id === e.id), f);
          if (v != null && (b == null || v > b)) b = v;
        }
        return b;
      };
      const recent = best(now - 28 * DAY, now + DAY);
      const before = best(now - 56 * DAY, now - 28 * DAY);
      const allTime = best(0, now + DAY);
      return { e, recent, before, allTime, last: done[0].started_at, sessions: done.length };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.last.localeCompare(a.last));

  const lastFull = weeks[weeks.length - 2];
  return (
    <>
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2>Weekly volume</h2>
          <span className="muted small">Last 12 weeks</span>
        </div>
        <WeeklyBars weeks={weeks} unit="kg" format={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}t` : String(Math.round(v)))} />
        <p className="chart-note">
          Weight × reps over working sets. This week so far: {fmtTonnage(thisWeek.value)}
          {lastFull.value > 0 ? `, last week ${fmtTonnage(lastFull.value)}` : ""}.
        </p>
      </section>

      <section className="section panel">
        <h2>Hard sets per muscle</h2>
        <p className="chart-note" style={{ marginTop: 2 }}>
          Working sets at RPE 7 or harder (or with no RPE logged). The shaded band is {SETS_LOW}–{SETS_HIGH} sets a week, a common evidence-based range for muscle growth. In a calorie deficit, holding volume steady is a good result.
        </p>
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
                  <div className="mtrack" aria-label={`${MUSCLE_LABEL[m]}: ${n} sets this week${avg != null ? `, ${Math.round(avg)} a week on average before` : ""}`}>
                    <div className="mband" style={{ left: `${(SETS_LOW / maxSets) * 100}%`, width: `${((SETS_HIGH - SETS_LOW) / maxSets) * 100}%` }} />
                    <div className="mbar" style={{ width: `${(n / maxSets) * 100}%` }} />
                    {avg != null && avg > 0 && <div className="mavg" style={{ left: `${(avg / maxSets) * 100}%` }} title="4-week average" />}
                  </div>
                  <span className="num mnum">{n}</span>
                </div>
              );
            })}
            <p className="legend"><span><i className="dot lift" /> This week</span><span><i className="tickmark" /> Average of previous 4 weeks</span></p>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Lifts</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>Best estimated 1RM in the last 4 weeks, against the 4 weeks before. Tap a lift for charts, rep maxes and a load calculator.</p>
        <div className="panel list-panel">
          {lifts.map(({ e, recent, before, allTime, sessions }) => (
            <button key={e.id} className="list-row" onClick={() => onOpenExercise(e.id)}>
              <span>
                <strong>{e.name}</strong>
                <span className="muted small" style={{ display: "block" }}>{MUSCLE_LABEL[e.muscle]}, {sessions} session{sessions === 1 ? "" : "s"}</span>
              </span>
              <span className="row-v num">
                {fmtKg(Math.round((recent ?? allTime ?? 0) * 10) / 10)}<span className="muted small"> kg</span>
                {recent != null && before != null ? <Delta v={pctChange(recent, before)} /> : null}
                {recent == null && <span className="muted small" style={{ display: "block" }}>not in 4 wks</span>}
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
