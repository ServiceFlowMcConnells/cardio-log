import type { AppData } from "../App";
import type { Session } from "../lib/types";
import type { Template, Workout } from "../lib/strength";
import { STATUS_LABEL, STATUS_TONE, coachExercise, deloadActive } from "../lib/coach";
import { fmtTonnage, isWorking, pctChange, volume } from "../lib/strength";
import { addDays, formatMinutes, formatShort, startOfWeek, weekKey } from "../lib/dates";
import { emptyWeek, groupByWeek, zoneFor } from "../lib/calc";
import SessionCard from "./SessionCard";
import WorkoutCard from "./WorkoutCard";
import { Delta } from "./WorkoutLogger";
import type { Checkin } from "../lib/readiness";
import { BAND_LABEL, PHASE_LABEL, adjustmentFor, latestPhase, todaysCheckin, weeklyLossPct } from "../lib/readiness";
import { AREA_LABEL, daysThisWeek, doneToday, fmtMin, needsRetest } from "../lib/mobility";
import { buildRoutine } from "./MobilityPlayer";

const DAY_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  data: AppData;
  onLogCardio: () => void;
  onOpenSession: (s: Session) => void;
  onOpenWorkout: (w: Workout) => void;
  onTrain: () => void;
  onStart: (t: Template) => void;
  onWarmup: (t: Template) => void;
  onMobility: () => void;
  onDailyMobility: () => void;
  goSettings: () => void;
  onScan: (c: Checkin | null) => void;
}

export default function WeekView({ data, onLogCardio: onLog, onOpenSession: onOpen, onOpenWorkout, onTrain, onStart, onWarmup, onMobility, onDailyMobility, goSettings, onScan }: Props) {
  const { sessions, settings, workouts, exercises } = data;
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
        <div>
          <h1>This week</h1>
          <span className="muted small">
            {formatShort(start)} – {formatShort(addDays(start, 6))}
          </span>
        </div>
        <button className="icon-btn gear" onClick={goSettings} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
          </svg>
        </button>
      </div>

      <ReadinessCard checkins={data.checkins} onScan={onScan} />

      <StrengthWeek data={data} start={start} onOpen={onOpenWorkout} onTrain={onTrain} onStart={onStart} onWarmup={onWarmup} />

      <MobilityCard data={data} onOpen={onMobility} onPlay={onDailyMobility} />

      <h2 className="section" style={{ marginBottom: 10 }}>Cardio</h2>
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
            <>Target hit. Anything more this week is a bonus.</>
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
        <h3 style={{ marginBottom: 8 }}>Cardio sessions</h3>
        {w.sessions.length === 0 ? (
          <div className="empty">
            <p>Log a session after you finish on the treadmill or bike.</p>
            <button className="btn primary" onClick={onLog}>Log cardio</button>
          </div>
        ) : (
          <>
            {w.sessions.map((s) => (
              <SessionCard key={s.id} session={s} settings={settings} onOpen={onOpen} />
            ))}
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={onLog}>Log cardio</button>
          </>
        )}
        {w.calories > 0 && <p className="muted small" style={{ marginTop: 10 }}>Machine-reported calories this week: {Math.round(w.calories)}. Treat these as rough.</p>}
        {w.minutes > 0 && <p className="muted small" style={{ marginTop: 4 }}>Total time this week: {formatMinutes(w.minutes)}.</p>}
      </section>
    </>
  );
}

function NextUp({ data, onStart, onWarmup }: { data: AppData; onStart: (t: Template) => void; onWarmup: (t: Template) => void }) {
  const { templates, workouts, exercises, settings, checkins } = data;
  if (!templates.length) return null;
  // The template you've gone longest without (never done counts as longest)
  const lastDone = (t: Template) => workouts.find((w) => w.template_id === t.id)?.started_at ?? "";
  const t = [...templates].sort((a, b) => lastDone(a).localeCompare(lastDone(b)) || a.position - b.position)[0];
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const today = todaysCheckin(checkins);
  const opts = { formula: settings.e1rm_formula, inc: settings.weight_increment, adj: today ? adjustmentFor(today) : null, deload: deloadActive(settings.deload_until), phase: latestPhase(checkins) };
  const nowIso = new Date().toISOString();
  const last = lastDone(t);
  return (
    <div className="tpl next-up">
      <div className="tpl-head">
        <h3>Next up: {t.name}</h3>
        <span className="muted small">{last ? `last ${formatShort(new Date(last))}` : "not done yet"}</span>
      </div>
      <ul className="tpl-list">
        {t.exercises.map((te, i) => {
          const p = coachExercise(exMap.get(te.exercise_id), te.exercise_id,
            { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg },
            workouts, templates, nowIso, opts);
          return (
            <li key={i}>
              <strong>{exMap.get(te.exercise_id)?.name ?? "Exercise"}</strong>{" "}
              <span className="muted">{p?.weight != null ? p.headline : `${te.sets} × ${te.rep_min === te.rep_max ? te.rep_min : `${te.rep_min}–${te.rep_max}`}`}</span>
              {p && p.status !== "build_reps" && p.status !== "new" && <span className={`coach-chip tone-${STATUS_TONE[p.status]}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[p.status]}</span>}
            </li>
          );
        })}
      </ul>
      <div className="tpl-foot">
        <span className="muted small">{today ? "Adjusted for today's readiness" : "A readiness scan runs first"}</span>
        <span className="tpl-btns">
          <button className="btn ghost" onClick={() => onWarmup(t)} title="5-minute mobility warm-up, then start">Warm-up</button>
          <button className="btn primary" onClick={() => onStart(t)}>Start</button>
        </span>
      </div>
    </div>
  );
}

function StrengthWeek({ data, start, onOpen, onTrain, onStart, onWarmup }: { data: AppData; start: Date; onOpen: (w: Workout) => void; onTrain: () => void; onStart: (t: Template) => void; onWarmup: (t: Template) => void }) {
  const { workouts, exercises } = data;
  const end = addDays(start, 7).getTime();
  const lastStart = addDays(start, -7).getTime();
  const inRange = (w: Workout, a: number, b: number) => { const t = new Date(w.started_at).getTime(); return t >= a && t < b; };
  const thisWeek = workouts.filter((w) => inRange(w, start.getTime(), end));
  const lastWeek = workouts.filter((w) => inRange(w, lastStart, start.getTime()));
  const vol = thisWeek.reduce((a, w) => a + volume(w.sets), 0);
  const lastVol = lastWeek.reduce((a, w) => a + volume(w.sets), 0);
  const sets = thisWeek.reduce((a, w) => a + w.sets.filter(isWorking).length, 0);
  // Like-for-like: last week's volume up to the same point in the week
  const elapsed = Date.now() - start.getTime();
  const lastSoFar = workouts.filter((w) => inRange(w, lastStart, lastStart + elapsed)).reduce((a, w) => a + volume(w.sets), 0);

  return (
    <section className="section" style={{ marginTop: 6 }}>
      <h2 style={{ marginBottom: 10 }}>Strength</h2>
      <NextUp data={data} onStart={onStart} onWarmup={onWarmup} />
      {thisWeek.length === 0 ? (
        <div className="empty" style={{ marginTop: 10 }}>
          <p>No lifting logged this week{lastWeek.length ? ` (${lastWeek.length} workout${lastWeek.length === 1 ? "" : "s"} last week)` : ""}.</p>
          {!data.templates.length && <button className="btn primary" onClick={onTrain}>{exercises.length ? "Create a workout template" : "Set up your exercises"}</button>}
        </div>
      ) : (
        <>
          <div className="stats" style={{ marginTop: 10 }}>
            <div className="stat"><div className="v">{thisWeek.length}</div><div className="l">workout{thisWeek.length === 1 ? "" : "s"}</div></div>
            <div className="stat"><div className="v">{sets}</div><div className="l">working sets</div></div>
            <div className="stat">
              <div className="v" style={{ fontSize: "1.35rem", whiteSpace: "nowrap" }}>{fmtTonnage(vol)}</div>
              <div className="l">volume {lastSoFar > 0 && <Delta v={pctChange(vol, lastSoFar)} digits={0} />}</div>
            </div>
          </div>
          {lastVol > 0 && <p className="muted small" style={{ marginTop: 6 }}>Volume change is against last week up to the same day ({fmtTonnage(lastVol)} for the full week).</p>}
          <div style={{ marginTop: 8 }}>
            {thisWeek.map((w) => <WorkoutCard key={w.id} workout={w} exercises={exercises} onOpen={onOpen} />)}
          </div>
        </>
      )}
    </section>
  );
}

function MobilityCard({ data, onOpen, onPlay }: { data: AppData; onOpen: () => void; onPlay: () => void }) {
  const test = data.mobilityTests[0] ?? null;
  const done = doneToday(data.mobilitySessions);
  const days = daysThisWeek(data.mobilitySessions);
  const routine = done ? null : buildRoutine(data, "daily", null);
  const focus = routine?.focus.slice(0, 3).map((s) => AREA_LABEL[s.area]).join(", ");
  return (
    <section className="section">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Mobility</h2>
        <button className="link small" onClick={onOpen}>{test ? `Score ${test.score}` : "Set up"} ›</button>
      </div>
      {done ? (
        <button className="mob-strip done" onClick={onOpen}>
          <span className="mob-tick" aria-hidden="true">✓</span>
          <span style={{ flex: 1, textAlign: "left" }}><strong>Done today</strong> <span className="small">{fmtMin(done.duration_sec)}, {days} day{days === 1 ? "" : "s"} this week</span></span>
          <span aria-hidden="true">›</span>
        </button>
      ) : (
        <div className="mob-strip">
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong>10-min routine</strong> <span className="small">{focus || "Full body"}</span>
            <span className="small muted" style={{ display: "block" }}>
              {!test ? "General until you take the screen" : needsRetest(test) ? "Retest due: it's been 4 weeks" : `${days} day${days === 1 ? "" : "s"} in the last 7`}
            </span>
          </span>
          <button className="btn dark" onClick={onPlay} disabled={!routine?.items.length}>Start</button>
        </div>
      )}
    </section>
  );
}

function ReadinessCard({ checkins, onScan }: { checkins: Checkin[]; onScan: (c: Checkin | null) => void }) {
  const today = todaysCheckin(checkins);
  const rate = weeklyLossPct(checkins);
  const lastW = checkins.find((c) => c.bodyweight_kg != null);
  if (!today) {
    return (
      <button className="ready-strip none" style={{ marginBottom: 10 }} onClick={() => onScan(null)}>
        <span style={{ flex: 1, textAlign: "left" }}>
          <strong>Readiness scan</strong>{" "}
          <span className="small">Rate sleep, energy and soreness, and log your weight. It tunes today's lifting loads.</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    );
  }
  const a = adjustmentFor(today);
  return (
    <button className={`ready-strip band-${a.band}`} style={{ marginBottom: 10 }} onClick={() => onScan(today)}>
      <span className="ready-score sm">{today.score}</span>
      <span style={{ flex: 1, textAlign: "left" }}>
        <strong>{BAND_LABEL[a.band]}</strong> <span className="small">{a.headline}</span>
        {latestPhase(checkins) && <span className="chip" style={{ marginLeft: 6 }}>{PHASE_LABEL[latestPhase(checkins)!]}</span>}
        {(today.sleep_hours != null || lastW) && (
          <span className="small" style={{ display: "block", opacity: 0.85 }}>
            {today.sleep_hours != null ? `${today.sleep_hours} h sleep` : ""}
            {today.sleep_hours != null && lastW ? ", " : ""}
            {lastW ? `${lastW.bodyweight_kg} kg` : ""}
            {rate != null ? ` (${rate >= 0 ? "−" : "+"}${Math.abs(rate).toFixed(1)}%/wk)` : ""}
          </span>
        )}
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}
