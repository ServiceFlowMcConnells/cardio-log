import { useState } from "react";
import { CardioHero, NutritionHero, RecoveryHero, WeightHero } from "./progress/Heroes";
import { DeskRangeContext, PHONE_PRESETS, PHONE_RANGE_KEY, loadDeskRange, rangeLabel, saveDeskRange, type DeskRange } from "../lib/deskRange";
import { PhotosCard } from "./photos/ProgressPhotos";
import type { AppData } from "../App";
import type { Block, Machine, Session, Settings } from "../lib/types";
import StrengthProgress from "./StrengthProgress";
import BodyProgress, { type BodyMore } from "./BodyProgress";
import NutritionTrends from "./food/NutritionTrends";
import WeightView from "./food/Weight";
import type { NutritionData } from "../lib/nutrition";
import type { Checkin } from "../lib/readiness";
import { MACHINE_LABEL } from "../lib/types";
import { formatShort, weekLabel } from "../lib/dates";
import { benchmarkKey, groupByWeek, outputPerBeat, recentWeeks, sessionMinutes, settingsSummary, zoneFor } from "../lib/calc";
import { WeeklyBars, TrendChart, trendText, type Point } from "./Charts";
import { inRange, rangeWeeks, useDeskRange } from "../lib/deskRange";
import { useDesktop } from "../lib/desktop";
import { weekHasIllness } from "../lib/illness";
import type { Workout } from "../lib/strength";
import Note from "./Note";

function OutputSection({ machine, sessions }: { machine: Machine; sessions: Session[] }) {
  const desk = useDeskRange();
  const points: Point[] = [];
  for (const s of sessions) {
    if (desk && !inRange(desk.range, s.performed_at)) continue;
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
        <Note>Log {needs} on a {MACHINE_LABEL[machine].toLowerCase()} block to start this chart.</Note>
      ) : (
        <>
          <TrendChart points={points} color={color} unit={unit} />
          <Note>
            {machine === "treadmill"
              ? "Estimated workload (from speed and incline) per 100 heartbeats."
              : "Watts produced per heartbeat."}{" "}
            Going up means you're doing more work at the same heart rate.
          </Note>
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
        <Note>
          Every 4 weeks, repeat the same test, for example 20 min at 5 km/h and 12% incline. Tick "Benchmark test" when you log it.
          A lower average heart rate at the same settings means you're fitter.
        </Note>
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
  // (Records moved to the tab's tiles)
  const z = zoneFor(settings);
  const map = groupByWeek(sessions, z);
  const desk = useDeskRange();
  const histWeeks = sessions.length ? Math.ceil((Date.now() - new Date(sessions[sessions.length - 1].performed_at).getTime()) / (7 * 86400000)) + 1 : 12;
  const nWeeks = desk ? Math.max(4, Math.min(104, rangeWeeks(desk.range) ?? histWeeks)) : 12;
  const weeks = recentWeeks(map, nWeeks);
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

      <section className="panel prog-card" id="chart-cardio-weeks">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2>Weekly minutes</h2>
          <span className="muted small">Last {nWeeks} weeks</span>
        </div>
        <WeeklyBars weeks={weeks.map((w) => ({ start: w.start, value: w.minutes }))} target={target} unit="min" ill={weekHasIllness} />
        <Note>
          {completed.length > 0
            ? `Target hit in ${hits} of ${completed.length} finished week${completed.length === 1 ? "" : "s"} since you started. Dashed line is your ${target} min target; green bars hit it.`
            : `Dashed line is your ${target} min target. Weeks turn green when you hit it.`}
        </Note>
      </section>

      <section className="section prog-group" id="chart-cardio-output">
        <h2>Fitness: output per heartbeat</h2>
        <p className="muted small" style={{ marginBottom: 10 }}>Your cardio version of lifting more for the same reps.</p>
        <div className="stack">
          <OutputSection machine="treadmill" sessions={sessions} />
          <OutputSection machine="bike" sessions={sessions} />
        </div>
      </section>

      <section className="section prog-group">
        <h2>Benchmark tests</h2>
        <Benchmarks sessions={sessions} />
      </section>

    </>
  );
}

export type Mode = "cardio" | "strength" | "body" | "nutrition" | "weight";
export const MODE_KEY = "cardio-log:progress-mode";
export const PROGRESS_MODES: { id: Mode; label: string }[] = [
  { id: "strength", label: "Strength" }, { id: "cardio", label: "Cardio" }, { id: "nutrition", label: "Nutrition" }, { id: "weight", label: "Weight" }, { id: "body", label: "Recovery" },
];

export default function Progress({ data, onLog, onOpenExercise, onOpenCheckin, onOpenFoodDay, setNutri, onPhotos, mode: modeProp, onChanged, onOpenWorkout }: { data: AppData; onLog: () => void; onOpenExercise: (id: string) => void; onOpenCheckin: (c: Checkin | null) => void; onOpenFoodDay: (day: string) => void; setNutri: (f: (n: NutritionData) => NutritionData) => void; onPhotos: (add?: boolean) => void; mode?: Mode; onChanged?: () => void; onOpenWorkout?: (w: Workout) => void }) {
  const desktop = useDesktop();
  const [ownMode, setMode] = useState<Mode>(() => {
    try { return (localStorage.getItem(MODE_KEY) as Mode) || "strength"; } catch { return "strength"; }
  });
  const mode = modeProp ?? ownMode;
  // Phone: one range for the whole tab, under the tabs (the laptop's is in the top bar)
  const [phoneRange, setPhoneRangeState] = useState<DeskRange>(() => loadDeskRange(PHONE_RANGE_KEY, "3m"));
  const setPhoneRange = (r: DeskRange) => { setPhoneRangeState(r); saveDeskRange(r, PHONE_RANGE_KEY); };
  const [bodyMore, setBodyMore] = useState<BodyMore>(null);
  const pick = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };
  const content = (
    <>
      {mode === "cardio" && data.sessions.length > 0 && <CardioHero data={data} />}
      {mode === "nutrition" && <NutritionHero data={data} />}
      {mode === "weight" && <WeightHero data={data} onLog={() => document.getElementById("weigh-in")?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
      {mode === "body" && data.checkins.length > 0 && <RecoveryHero data={data} onActivity={() => setBodyMore("activity")} />}
      {mode === "nutrition" && <div id="chart-nutrition" className="prog-has-hero"><NutritionTrends nutri={data.nutrition} onOpenDay={onOpenFoodDay} /></div>}
      {mode === "weight" && <PhotosCard onOpen={() => onPhotos()} onAdd={() => onPhotos(true)} />}
      {mode === "weight" && <div id="chart-weight"><WeightView nutri={data.nutrition} checkins={data.checkins} setNutri={setNutri} embedded /></div>}
      {mode === "strength" && desktop && <StrengthProgress data={data} onLog={onLog} onOpenExercise={onOpenExercise} onChanged={onChanged} onOpenWorkout={onOpenWorkout} />}
      <div className="progress-body">
      {mode === "cardio" && <CardioProgress sessions={data.sessions} settings={data.settings} onLog={onLog} />}
      {mode === "strength" && !desktop && <StrengthProgress data={data} onLog={onLog} onOpenExercise={onOpenExercise} />}
      {mode === "body" && <BodyProgress data={data} onScan={onOpenCheckin} more={bodyMore} setMore={setBodyMore} />}
      </div>
    </>
  );
  return (
    <div className="prog">
      <div className="page-head"><h1>Progress</h1></div>
      {!modeProp && <div className="seg progress-seg" role="group" aria-label="Progress type" >
        <button className={mode === "strength" ? "on" : ""} aria-pressed={mode === "strength"} onClick={() => pick("strength")}>Strength</button>
        <button className={mode === "cardio" ? "on" : ""} aria-pressed={mode === "cardio"} onClick={() => pick("cardio")}>Cardio</button>
        <button className={mode === "nutrition" ? "on" : ""} aria-pressed={mode === "nutrition"} onClick={() => pick("nutrition")}>Nutrition</button>
        <button className={mode === "weight" ? "on" : ""} aria-pressed={mode === "weight"} onClick={() => pick("weight")}>Weight</button>
        <button className={mode === "body" ? "on" : ""} aria-pressed={mode === "body"} onClick={() => pick("body")}>Recovery</button>
      </div>}
      {desktop ? <div className="home prog-body">{content}</div> : (
        <DeskRangeContext.Provider value={{ range: phoneRange, setRange: setPhoneRange }}>
          <div className="prog-range">
            <div className="seg-range" role="group" aria-label={`Range: ${rangeLabel(phoneRange)}`}>
              {PHONE_PRESETS.map((p) => <button key={p.id} className={phoneRange.preset === p.id ? "on" : ""} aria-pressed={phoneRange.preset === p.id} onClick={() => setPhoneRange({ preset: p.id })}>{p.label}</button>)}
            </div>
          </div>
          <div className="home prog-body">{content}</div>
        </DeskRangeContext.Provider>
      )}
    </div>
  );
}
