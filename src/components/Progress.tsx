import type { Block, Machine, Session, Settings } from "../lib/types";
import { MACHINE_LABEL } from "../lib/types";
import { formatShort, weekLabel } from "../lib/dates";
import { benchmarkKey, groupByWeek, outputPerBeat, recentWeeks, round, sessionMinutes, settingsSummary, zoneFor } from "../lib/calc";

interface Point { t: number; v: number }

function WeeklyBars({ weeks, target }: { weeks: { start: Date; minutes: number }[]; target: number }) {
  const W = 340, H = 170, padL = 30, padB = 22, padT = 10;
  const max = Math.max(target * 1.15, ...weeks.map((w) => w.minutes), 30);
  const bw = (W - padL) / weeks.length;
  const y = (m: number) => padT + (H - padT - padB) * (1 - m / max);
  const gridStep = max > 300 ? 100 : 50;
  const grid = [];
  for (let g = 0; g <= max; g += gridStep) grid.push(g);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly minutes for the last ${weeks.length} weeks against a ${target} minute target`}>
      {grid.map((g) => (
        <g key={g}>
          <line className="axis" x1={padL} x2={W} y1={y(g)} y2={y(g)} opacity={g === 0 ? 1 : 0.6} />
          <text x={padL - 6} y={y(g) + 4} textAnchor="end">{g}</text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const h = y(0) - y(w.minutes);
        const hit = w.minutes >= target;
        return (
          <g key={i}>
            <rect
              x={padL + i * bw + bw * 0.18}
              y={y(w.minutes)}
              width={bw * 0.64}
              height={Math.max(0, h)}
              rx={3}
              fill={hit ? "var(--in)" : "var(--ink)"}
              opacity={i === weeks.length - 1 ? 1 : 0.8}
            >
              <title>{`${weekLabel(w.start)}: ${Math.round(w.minutes)} min`}</title>
            </rect>
            {(i % 2 === (weeks.length - 1) % 2) && (
              <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle">{formatShort(w.start)}</text>
            )}
          </g>
        );
      })}
      <line className="target" x1={padL} x2={W} y1={y(target)} y2={y(target)} />
    </svg>
  );
}

function TrendChart({ points, color, unit }: { points: Point[]; color: string; unit: string }) {
  const W = 340, H = 160, padL = 34, padB = 22, padT = 10, padR = 8;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  let t0 = Math.min(...ts), t1 = Math.max(...ts);
  if (t1 - t0 < 86400000) { t0 -= 86400000 * 3; t1 += 86400000 * 3; }
  let v0 = Math.min(...vs), v1 = Math.max(...vs);
  const pad = Math.max((v1 - v0) * 0.2, v1 * 0.05, 0.1);
  v0 -= pad; v1 += pad;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - v0) / (v1 - v0));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const yTicks = [v0 + pad, (v0 + v1) / 2, v1 - pad];
  const xTicks = [t0, (t0 + t1) / 2, t1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend in ${unit}`}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line className="axis" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} opacity={0.6} />
          <text x={padL - 6} y={y(v) + 4} textAnchor="end">{round(v, v < 10 ? 2 : 1)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{formatShort(new Date(t))}</text>
      ))}
      {points.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" opacity={0.55} />}
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.v)} r={4} fill={color}>
          <title>{`${formatShort(new Date(p.t))}: ${round(p.v, 2)} ${unit}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function trendText(points: Point[]): { text: string; dir: "up" | "down" | "flat" } | null {
  if (points.length < 4) return null;
  const n = Math.min(3, Math.floor(points.length / 2));
  const avg = (a: Point[]) => a.reduce((s, p) => s + p.v, 0) / a.length;
  const first = avg(points.slice(0, n));
  const last = avg(points.slice(-n));
  const pct = ((last - first) / first) * 100;
  if (Math.abs(pct) < 1.5) return { text: "Holding steady", dir: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${round(pct, 0)}% vs your first sessions`, dir: pct > 0 ? "up" : "down" };
}

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3><i className={`dot ${machine}`} /> {MACHINE_LABEL[machine]}</h3>
        {trend && <span className={`trend ${trend.dir}`}>{trend.text}</span>}
      </div>
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

export default function Progress({ sessions, settings, onLog }: { sessions: Session[]; settings: Settings; onLog: () => void }) {
  const z = zoneFor(settings);
  const map = groupByWeek(sessions, z);
  const weeks = recentWeeks(map, 12);
  const target = settings.weekly_target_min;
  const completed = weeks.slice(0, -1);
  const hits = completed.filter((w) => w.minutes >= target).length;
  const activeWeeks = completed.filter((w) => w.minutes > 0).length;

  if (sessions.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Progress</h1></div>
        <div className="empty">
          <p>Your trends appear here once you've logged a few sessions.</p>
          <button className="btn primary" onClick={onLog}>Log session</button>
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
  let steepest: { label: string; date: Date; score: number } | null = null;
  for (const s of sessions) {
    for (const b of s.blocks) {
      if (b.machine === "bike" && b.avg_watts != null && (!bestWatts || b.avg_watts > bestWatts.w)) bestWatts = { w: b.avg_watts, date: new Date(s.performed_at) };
      if (b.machine === "treadmill" && b.speed_kmh) {
        const score = b.speed_kmh * (1 + (b.incline_pct ?? 0) / 10) * Math.min(b.duration_min, 60);
        if (!steepest || score > steepest.score) steepest = { score, label: settingsSummary(b) + `, ${Math.round(b.duration_min)} min`, date: new Date(s.performed_at) };
      }
    }
  }

  return (
    <>
      <div className="page-head"><h1>Progress</h1></div>

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2>Weekly minutes</h2>
          <span className="muted small">Last 12 weeks</span>
        </div>
        <WeeklyBars weeks={weeks} target={target} />
        <p className="chart-note">
          {activeWeeks > 0
            ? `Target hit in ${hits} of the last ${completed.length} finished weeks. Dashed line is your ${target} min target; green bars hit it.`
            : `Dashed line is your ${target} min target. Finished weeks turn green when you hit it.`}
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
              <div className="v" style={{ fontSize: "1.2rem", lineHeight: 1.15 }}>{steepest.label}</div>
              <div className="l">Toughest treadmill block, {formatShort(steepest.date)}</div>
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
