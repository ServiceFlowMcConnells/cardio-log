import { formatShort, weekLabel } from "../lib/dates";
import { round } from "../lib/calc";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export interface Point { t: number; v: number }

export function WeeklyBars({ weeks, target, unit, format = (v) => String(Math.round(v)) }: { weeks: { start: Date; value: number }[]; target?: number; unit: string; format?: (v: number) => string }) {
  const W = 340, H = 170, padL = 30, padB = 22, padT = 10;
  const max = niceMax(Math.max((target ?? 0) * 1.15, ...weeks.map((w) => w.value), unit === "min" ? 30 : 1));
  const bw = (W - padL) / weeks.length;
  const y = (m: number) => padT + (H - padT - padB) * (1 - m / max);
  const gridStep = max / 4;
  const grid = [];
  for (let i = 0; i <= 4; i++) grid.push(gridStep * i);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly ${unit} for the last ${weeks.length} weeks${target ? ` against a target of ${target}` : ""}`}>
      {grid.map((g) => (
        <g key={g}>
          <line className="axis" x1={padL} x2={W} y1={y(g)} y2={y(g)} opacity={g === 0 ? 1 : 0.6} />
          <text x={padL - 6} y={y(g) + 4} textAnchor="end">{format(g)}</text>
        </g>
      ))}
      {weeks.map((w, i) => {
        const h = y(0) - y(w.value);
        const hit = target != null && w.value >= target;
        return (
          <g key={i}>
            <rect
              x={padL + i * bw + bw * 0.18}
              y={y(w.value)}
              width={bw * 0.64}
              height={Math.max(0, h)}
              rx={3}
              fill={hit ? "var(--in)" : "var(--ink)"}
              opacity={i === weeks.length - 1 ? 1 : 0.8}
            >
              <title>{`${weekLabel(w.start)}: ${format(w.value)} ${unit}`}</title>
            </rect>
            {(i % 2 === (weeks.length - 1) % 2) && (
              <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle">{formatShort(w.start)}</text>
            )}
          </g>
        );
      })}
      {target != null && <line className="target" x1={padL} x2={W} y1={y(target)} y2={y(target)} />}
    </svg>
  );
}

export function TrendChart({ points, color, unit }: { points: Point[]; color: string; unit: string }) {
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
  const span = v1 - v0;
  const yTicks = points.length > 1 && Math.max(...vs) > Math.min(...vs) ? [v0 + span * 0.15, (v0 + v1) / 2, v1 - span * 0.15] : [(v0 + v1) / 2];
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

export function trendText(points: Point[], suffix = "vs your first sessions"): { text: string; dir: "up" | "down" | "flat" } | null {
  if (points.length < 4) return null;
  const n = Math.min(3, Math.floor(points.length / 2));
  const avg = (a: Point[]) => a.reduce((s, p) => s + p.v, 0) / a.length;
  const first = avg(points.slice(0, n));
  const last = avg(points.slice(-n));
  const pct = ((last - first) / first) * 100;
  if (Math.abs(pct) < 1.5) return { text: "Holding steady", dir: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${round(pct, 0)}% ${suffix}`, dir: pct > 0 ? "up" : "down" };
}

