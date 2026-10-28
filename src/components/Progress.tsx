import { useState } from "react";
import type { AppData } from "../App";
import type { Block, Machine, Session, Settings } from "../lib/types";
import StrengthProgress from "./StrengthProgress";
import MobilityProgress from "./MobilityProgress";
import BodyProgress from "./BodyProgress";
import type { Checkin } from "../lib/readiness";
import { MACHINE_LABEL } from "../lib/types";
import { formatShort, weekLabel } from "../lib/dates";
import { benchmarkKey, groupByWeek, outputPerBeat, recentWeeks, sessionMinutes, settingsSummary, zoneFor } from "../lib/calc";
import { WeeklyBars, TrendChart, trendText, type Point } from "./Charts";

function OutputSection({ machine, sessions }: { machine: Machine; sessions: Session[] }) {
  const points: Point[] = [];
  for (const s of sessions) {
    for (const b of s.blocks) {
      if (b.machine !== machine) continue;
      const v = outputPerBeat(b);
      if (v != null) points.push({ t: new Date(s.performed_at).getTime(), v });
    }
  }
  points.sort((a, b) => a.t - b.t);
  const unit = machine === "treadmill" ? "METs per 100 bpm" : "watts per bpm";
  const color = machine === "treadmill" ? "var(--tread)" : "var(--bike)";
  const trend = trendText(points);
  const needs = machine === "treadmill" ? "speed and average heart rate" : "average watts and average heart rate";

  return (
    <div className="panel">
      <h3><i className={`dot ${machine}`} /> {MACHINE_LABEL[machine]}</h3>
      {trend && <p className={`trend ${trend.dir}`}>{trend.text}</p>}
      {points.length === 0 ? (
        <p className="chart-note">Log {needs} on a {MACHINE_LABEL[machine].toLowerCase()} block to start this chart.</p>
      ) : (
        <>
          <TrendChart points={points} color={color} unit={unit} />
          <p className="chart-note">
            {machine === "treadmill"
              ? "Estimated workload (from speed and incline) per 100 heartbeats."
              : "Watts produced per heartbeat."}{" "}
            Going up means you're doing more work at the same heart rate.
          </p>
        </>
      )}
    </div>
  );
}

function Benchmarks({ sessions }: { sessions: Session[] }) {
  const groups = new Map<string, { block: Block; date: Date }[]>();
  for (const s of sessions) {
    for (const b of s.blocks) {
      if (!b.is_benchmark) continue;
      const k = benchmarkKey(b);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ block: b, date: new Date(s.performed_at) });
    }
  }
  const list = [...groups.values()].map((g) => g.sort((a, b) => a.date.getTime() - b.date.getTime()));
  if (list.length === 0) {
    return (
      <div className="panel">
        <p>No benchmark tests yet.</p>
        <p className="chart-note">
          Every 4 weeks, repeat the same test, for example 20 min at 5 km/h and 12% incline. Tick "Benchmark test" when you log it.
          A lower average heart rate at the same settings means you're fitter.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      {list.map((g) => {
        const first = g[0].block;
        const isBike = first.machine === "bike";
        return (
          <div className="panel" key={benchmarkKey(first)}>
            <h3><i className={`dot ${first.machine}`} /> {MACHINE_LABEL[first.machine]}, {Math.round(first.duration_min)} min{settingsSummary(first) ? ` at ${settingsSummary(first).replace(/, \d+ W$/, "")}` : ""}</h3>
            <table className="bench" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Avg HR</th>
                  {isBike && <th>Watts</th>}
                  <th>vs first</th>
                </tr>
              </thead>
              <tbody>
                {g.map(({ block, date }, i) => {
                  const diff = block.avg_hr != null && first.avg_hr != null && i > 0 ? block.avg_hr - first.avg_hr : null;
                  return (
                    <tr key={i}>
                      <td>{formatShort(date)}</td>
                      <td>{block.avg_hr ?? "–"}</td>
                      {isBike && <td>{block.avg_watts ?? "–"}</td>}
                      <td style={{ color: diff == null ? undefined : diff < 0 ? "var(--in)" : diff > 0 ? "var(--over)" : undefined }}>
                        {diff == null ? "–" : `${diff > 0 ? "+" : ""}${diff} bpm`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function CardioProgress({ sessions, settings, onLog }: { sessions: Session[]; settings: Settings; onLog: () => void }) {
  const z = zoneFor(settings);
  const map = groupByWeek(sessions, z);
  const weeks = recentWeeks(map, 12);
  const target = settings.weekly_target_min;
  const firstLogged = sessions.length ? new Date(sessions[sessions.length - 1].performed_at).getTime() : Date.now();
  // Only count finished weeks since you started logging
  const completed = weeks.slice(0, -1).filter((w) => w.start.getTime() + 7 * 86400000 > firstLogged);
  const hits = completed.filter((w) => w.minutes >= target).length;

  if (sessions.length === 0) {
    return (
      <>
        <div className="empty">
          <p>Your cardio trends appear here once you've logged a few sessions.</p>
          <button className="btn primary" onClick={onLog}>Train</button>
        </div>
      </>
    );
  }

  // Records
  let longest: { min: number; date: Date } | null = null;
  for (const s of sessions) {
    const m = sessionMinutes(s);
    if (!longest || m > longest.min) longest = { min: m, date: new Date(s.performed_at) };
  }
  const allWeeks = [...map.values()];
  const bestWeek = allWeeks.reduce((a, w) => (w.minutes > a.minutes ? w : a), allWeeks[0]);
  let bestWatts: { w: number; date: Date } | null = null;
  let steepest: { incline: number; speed: number; date: Date } | null = null;
  for (const s of sessions) {
    for (const b of s.blocks) {
      if (b.machine === "bike" && b.avg_watts != null && (!bestWatts || b.avg_watts > bestWatts.w)) bestWatts = { w: b.avg_watts, date: new Date(s.performed_at) };
      if (b.machine === "treadmill" && b.incline_pct != null && b.speed_kmh != null) {
        const better = !steepest || b.incline_pct > steepest.incline || (b.incline_pct === steepest.incline && b.speed_kmh > steepest.speed);
        if (better) steepest = { incline: b.incline_pct, speed: b.speed_kmh, date: new Date(s.performed_at) };
      }
    }
  }

  return (
    <>

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2>Weekly minutes</h2>
          <span className="muted small">Last 12 weeks</span>
        </div>
        <WeeklyBars weeks={weeks.map((w) => ({ start: w.start, value: w.minutes }))} target={target} unit="min" />
        <p className="chart-note">
          {completed.length > 0
            ? `Target hit in ${hits} of ${completed.length} finished week${completed.length === 1 ? "" : "s"} since you started. Dashed line is your ${target} min target; green bars hit it.`
            : `Dashed line is your ${target} min target. Weeks turn green when you hit it.`}
        </p>
      </section>

      <section className="section">
        <h2>Fitness: output per heartbeat</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>Your cardio version of lifting more for the same reps.</p>
        <div className="stack">
          <OutputSection machine="treadmill" sessions={sessions} />
          <OutputSection machine="bike" sessions={sessions} />
        </div>
      </section>

      <section className="section">
        <h2>Benchmark tests</h2>
        <Benchmarks sessions={sessions} />
      </section>

      <section className="section">
        <h2>Records</h2>
        <div className="records">
          {longest && (
            <div className="stat">
              <div className="v">{Math.round(longest.min)} min</div>
              <div className="l">Longest session, {formatShort(longest.date)}</div>
            </div>
          )}
          {bestWeek && (
            <div className="stat">
              <div className="v">{Math.round(bestWeek.minutes)} min</div>
              <div className="l">Biggest week, {/^(This|Last) week$/.test(weekLabel(bestWeek.start)) ? weekLabel(bestWeek.start).toLowerCase() : weekLabel(bestWeek.start)}</div>
            </div>
          )}
          {steepest && (
            <div className="stat">
              <div className="v">{steepest.incline}%</div>
              <div className="l">Steepest incline (at {steepest.speed} km/h), {formatShort(steepest.date)}</div>
            </div>
          )}
          {bestWatts && (
            <div className="stat">
              <div className="v">{bestWatts.w} W</div>
              <div className="l">Highest bike average, {formatShort(bestWatts.date)}</div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

type Mode = "cardio" | "strength" | "body";
const MODE_KEY = "cardio-log:progress-mode";

export default function Progress({ data, onLog, onOpenExercise, onOpenCheckin, onMobility }: { data: AppData; onLog: () => void; onOpenExercise: (id: string) => void; onOpenCheckin: (c: Checkin | null) => void; onMobility: () => void }) {
  const [mode, setMode] = useState<Mode>(() => {
    try { return (localStorage.getItem(MODE_KEY) as Mode) || "strength"; } catch { return "strength"; }
  });
  const pick = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };
  return (
    <>
      <div className="page-head"><h1>Progress</h1></div>
      <div className="seg" role="group" aria-label="Progress type" style={{ marginBottom: 14 }}>
        <button className={mode === "strength" ? "on" : ""} aria-pressed={mode === "strength"} onClick={() => pick("strength")}>Strength</button>
        <button className={mode === "cardio" ? "on" : ""} aria-pressed={mode === "cardio"} onClick={() => pick("cardio")}>Cardio</button>
        <button className={mode === "body" ? "on" : ""} aria-pressed={mode === "body"} onClick={() => pick("body")}>Recovery</button>
      </div>
      {mode === "cardio" && <CardioProgress sessions={data.sessions} settings={data.settings} onLog={onLog} />}
      {mode === "strength" && <StrengthProgress data={data} onLog={onLog} onOpenExercise={onOpenExercise} />}
      {mode === "body" && <BodyProgress data={data} onScan={onOpenCheckin} />}
      {mode === "body" && <MobilityProgress data={data} onOpen={onMobility} />}
    </>
  );
}
