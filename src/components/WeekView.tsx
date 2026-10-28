import type { Session, Settings } from "../lib/types";
import { addDays, formatMinutes, formatShort, startOfWeek, weekKey } from "../lib/dates";
import { emptyWeek, groupByWeek, zoneFor } from "../lib/calc";
import SessionCard from "./SessionCard";

const DAY_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  sessions: Session[];
  settings: Settings;
  onLog: () => void;
  onOpen: (s: Session) => void;
  goSettings: () => void;
}

export default function WeekView({ sessions, settings, onLog, onOpen, goSettings }: Props) {
  const z = zoneFor(settings);
  const start = startOfWeek(new Date());
  const weeks = groupByWeek(sessions, z);
  const w = weeks.get(weekKey(start)) ?? emptyWeek(start);
  const last = weeks.get(weekKey(addDays(start, -7)));
  const target = settings.weekly_target_min;
  const scaleMax = Math.max(target, w.minutes, 30);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const daysLeft = 7 - todayIdx;
  const remaining = Math.max(0, target - w.minutes);
  const done = w.minutes >= target;

  // Belt segments, oldest first
  const segs = [...w.sessions]
    .sort((a, b) => a.performed_at.localeCompare(b.performed_at))
    .flatMap((s) => s.blocks.map((b) => ({ machine: b.machine, min: b.duration_min, key: `${s.id}-${b.position}` })));

  const ticks = [];
  for (let m = 0; m <= scaleMax; m += scaleMax > 240 ? 60 : 30) ticks.push(m);

  const dayMax = Math.max(...w.byDay, 30);

  return (
    <>
      <div className="page-head">
        <h1>This week</h1>
        <span className="muted small">
          {formatShort(start)} – {formatShort(addDays(start, 6))}
        </span>
      </div>

      <section className="belt-wrap" aria-label="Weekly cardio minutes">
        <div className="belt-figure">
          <span className="big">{Math.round(w.minutes)}</span>
          <span className="of">/ {target} min</span>
        </div>
        <div
          className={`belt${done ? " done" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={Math.round(w.minutes)}
          aria-label={`${Math.round(w.minutes)} of ${target} minutes`}
        >
          {segs.map((s) => (
            <div key={s.key} className={`seg ${s.machine}`} style={{ width: `${(s.min / scaleMax) * 100}%` }} />
          ))}
          {scaleMax > target && <div className="target-line" style={{ left: `calc(${(target / scaleMax) * 100}% - 1.5px)` }} />}
        </div>
        <div className="belt-scale" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="legend">
          <span><i className="dot treadmill" /> Treadmill</span>
          <span><i className="dot bike" /> Bike</span>
        </div>
        <p className="nudge">
          {done ? (
            <>Target hit. Anything more this week is a bonus for the deficit.</>
          ) : w.minutes === 0 ? (
            <>No cardio logged yet this week. {daysLeft > 1 ? `Spread over ${daysLeft} days, that's about ${Math.ceil(target / daysLeft)} min a day.` : `${target} min to go today.`}</>
          ) : (
            <>
              {Math.round(remaining)} min to go.{" "}
              {daysLeft > 1
                ? `Over the ${daysLeft} days left (today included), that's about ${Math.ceil(remaining / daysLeft)} min a day.`
                : "Today is the last day of the week."}
            </>
          )}
        </p>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="v">{w.sessions.length}</div>
          <div className="l">sessions</div>
        </div>
        <div className="stat">
          {z ? (
            <>
              <div className="v">{Math.round(w.zoneMinutes)}</div>
              <div className="l">min in zone ({z.low}–{z.high})</div>
            </>
          ) : (
            <>
              <div className="v">–</div>
              <div className="l">
                <button className="link small" onClick={goSettings}>Set max HR</button> to see zone time
              </div>
            </>
          )}
        </div>
        <div className="stat">
          <div className="v">{last ? Math.round(last.minutes) : 0}</div>
          <div className="l">min last week</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 8 }}>
        <div className="days" aria-label="Minutes per day">
          {w.byDay.map((m, i) => (
            <div key={i} className={`day${i === todayIdx ? " today" : ""}`} title={`${DAY_LETTERS[i]}: ${Math.round(m)} min`}>
              {m > 0 && <span className="small num">{Math.round(m)}</span>}
              <div className={`bar${m === 0 ? " zero" : ""}`} style={{ height: m > 0 ? `${Math.max(6, (m / dayMax) * 52)}px` : undefined }} />
              <span className="lbl">{DAY_LETTERS[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="section">
        <h2>Sessions</h2>
        {w.sessions.length === 0 ? (
          <div className="empty">
            <p>Log a session after you finish on the treadmill or bike.</p>
            <button className="btn primary" onClick={onLog}>Log session</button>
          </div>
        ) : (
          <>
            {w.sessions.map((s) => (
              <SessionCard key={s.id} session={s} settings={settings} onOpen={onOpen} />
            ))}
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onLog}>Log session</button>
          </>
        )}
        {w.calories > 0 && <p className="muted small" style={{ marginTop: 10 }}>Machine-reported calories this week: {Math.round(w.calories)}. Treat these as rough.</p>}
        {w.minutes > 0 && <p className="muted small" style={{ marginTop: 4 }}>Total time this week: {formatMinutes(w.minutes)}.</p>}
      </section>
    </>
  );
}
