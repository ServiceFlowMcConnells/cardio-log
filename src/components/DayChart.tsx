import { useMemo, useState } from "react";
import { addDays, fromYmd, todayYmd, ymd } from "../lib/nutrition";
import { startOfWeek } from "../lib/dates";
import { useDesktop } from "../lib/desktop";
import { useChartGestures } from "../lib/chartGestures";
import type { Agg, Range } from "./food/Weight";
import { WindowControls, WindowNav, autoAgg, useTimeWindow } from "./food/Weight";

/** One value per day (readiness score, hours slept, steps). */
export type DayValues = Map<string, number>;

interface Bucket { key: string; start: string; end: string; days: number; vals: number[]; avg: number | null }

const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => fromYmd(d).toLocaleDateString("en-IE", o);

function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 0.01)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export interface WindowStats { avg: number | null; total: number; logged: number; days: number; start: string; end: string; label: string }
/** "7-day average" for windows up to a month, "Average" beyond that. */
export const windowLabel = (days: number) => (days <= 31 ? `${days}-day average` : "Average");

export interface DayChartProps {
  title: string;
  /** Shown beside the title. A function follows the window on screen (range, panning and zoom), e.g. "7-day average 72". */
  sub?: string | ((w: WindowStats) => string | undefined);
  values: DayValues;
  kind: "bar" | "line";
  color?: string;
  /** Shaded "good" range on the value axis. */
  band?: [number, number];
  /** Dashed target line. */
  target?: number;
  /** A value as text, for the reading under the chart. */
  fmt: (v: number) => string;
  /** A value as an axis label. */
  axis: (v: number) => string;
  /** Extra text for a reading (days on target, band name). */
  extra?: (b: { vals: number[]; avg: number }) => string | null;
  barClass?: (v: number) => string;
  note?: string;
  initial?: Range;
  /** Value axis floor for line charts (readiness never shows below this unless a score is). */
  floor?: number;
  /** Hard limits of the value axis (readiness is 0–100). */
  clamp?: [number, number];
}

/** Recovery charts: same behaviour as the macros and weight charts. Ranges and day/week/month grouping, ‹ › to step,
 *  drag to move, pinch (or ctrl + scroll) to zoom, tap or hold to read a day. */
export function DayChartCard(p: DayChartProps) {
  const wide = useDesktop();
  const today = todayYmd();
  const days = useMemo(() => [...p.values.keys()].sort(), [p.values]);
  const first0 = days[0] ?? today;
  const first = first0 > addDays(today, -6) ? addDays(today, -6) : first0;
  const win = useTimeWindow(first, today, p.initial ?? 30);
  const span = Math.round((fromYmd(win.end).getTime() - fromYmd(win.start).getTime()) / 86400000);
  const agg: Agg = win.aggPick ?? autoAgg(span);
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const buckets = useMemo(() => {
    const keyOf = (d: string) => (agg === "D" ? d : agg === "W" ? ymd(startOfWeek(fromYmd(d))) : d.slice(0, 7));
    const out: Bucket[] = [];
    let cur: Bucket | null = null;
    const flush = () => { if (cur) { cur.avg = cur.vals.length ? cur.vals.reduce((a, b) => a + b, 0) / cur.vals.length : null; out.push(cur); } };
    for (let d = win.start; d <= win.end; d = addDays(d, 1)) {
      const k = keyOf(d);
      if (!cur || cur.key !== k) { flush(); cur = { key: k, start: d, end: d, days: 0, vals: [], avg: null }; }
      cur.end = d;
      cur.days++;
      const v = p.values.get(d);
      if (v != null) cur.vals.push(v);
    }
    flush();
    return out;
  }, [p.values, win.start, win.end, agg]);

  const all = buckets.flatMap((b) => b.vals);
  const winAvg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  const shown = hover ?? sel;
  const b = shown != null ? buckets[shown] : null;
  const pinch = (x: Parameters<typeof win.onPinch>[0]) => { if (x.phase === "start") setSel(null); win.onPinch(x); };
  const reset = () => { setSel(null); setHover(null); };

  return (
    <section className="section panel">
      <div className="page-head" style={{ marginBottom: 4 }}>
        <h2>{p.title}</h2>
        {(() => {
          const days = buckets.reduce((a, x) => a + x.days, 0);
          const t = typeof p.sub === "function"
            ? p.sub({ avg: winAvg, total: all.reduce((a, x) => a + x, 0), logged: all.length, days, start: win.start, end: win.end, label: windowLabel(days) })
            : p.sub;
          return t ? <span className="muted small">{t}</span> : null;
        })()}
      </div>
      <Chart {...p} buckets={buckets} agg={agg} active={shown} wide={wide} today={today}
        onPinch={pinch} onHover={setHover}
        onTap={(i) => { setHover(null); setSel((c) => (c === i ? null : i)); }}
        onHoldEnd={(i) => { setHover(null); setSel(i); }} />
      <div onClick={reset}><WindowNav w={win} /></div>
      <div onClick={reset}><WindowControls w={win} agg={agg} /></div>
      {b ? (
        <div className="ntr-sel">
          <strong>{agg === "D" ? fmtDay(b.start, { weekday: "short", day: "numeric", month: "short" }) : agg === "W" ? `Week of ${fmtDay(b.start, { day: "numeric", month: "short" })}` : fmtDay(b.start, { month: "long", year: "numeric" })}</strong>
          {b.avg != null ? (
            <span className="small">
              {agg !== "D" && "Daily average "}<strong>{p.fmt(b.avg)}</strong>
              {p.target != null && ` · target ${p.fmt(p.target)}`}
              {p.extra?.({ vals: b.vals, avg: b.avg }) ? ` · ${p.extra({ vals: b.vals, avg: b.avg })}` : ""}
              {agg !== "D" && ` · ${b.vals.length} of ${b.days} day${b.days === 1 ? "" : "s"} recorded`}
            </span>
          ) : <span className="small muted">Nothing recorded</span>}
        </div>
      ) : (
        <p className="muted small ntr-hint">
          {winAvg != null && <>Average <strong>{p.fmt(winAvg)}</strong> over this window ({all.length} day{all.length === 1 ? "" : "s"}). </>}
          {wide ? "Hover or click to read; drag to move, ctrl + scroll to zoom." : "Tap to read · hold and slide · drag to move · pinch to zoom."}
        </p>
      )}
      {p.note && <p className="chart-note">{p.note}</p>}
    </section>
  );
}

function Chart({ buckets, agg, active, wide, today, kind, color = "var(--ink)", band, target, axis, barClass, floor, clamp, onPinch, onHover, onTap, onHoldEnd, title }: DayChartProps & {
  buckets: Bucket[]; agg: Agg; active: number | null; wide: boolean; today: string;
  onPinch: Parameters<typeof useChartGestures>[0]["onPinch"]; onHover: (i: number | null) => void; onTap: (i: number) => void; onHoldEnd: (i: number) => void;
}) {
  const W = wide ? 900 : 340, H = wide ? 240 : 170, padL = 8, padR = 36, padT = 8, padB = 22;
  const n = buckets.length;
  const slot = (W - padL - padR) / Math.max(1, n);
  const at = (clientX: number) => {
    const r = rect();
    if (!r || !n) return 0;
    const vx = ((clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.floor((vx - padL) / slot)));
  };
  const { bind, rect } = useChartGestures({
    onPinch,
    read: (x) => onHover(at(x)),
    clear: () => onHover(null),
    tap: (x) => onTap(at(x)),
    readDone: (x) => onHoldEnd(at(x)),
  });

  const vals = buckets.map((b) => b.avg).filter((v): v is number => v != null);
  let lo: number, hi: number;
  if (kind === "bar") { lo = 0; hi = Math.max(1, ...vals, (target ?? 0) * 1.1); }
  else {
    lo = Math.min(...vals, ...(band ?? []), ...(floor != null ? [floor] : []));
    hi = Math.max(...vals, ...(band ?? []));
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const pad = Math.max((hi - lo) * 0.08, 0.5);
    lo -= pad; hi += pad;
  }
  const step = niceStep((hi - lo) / 3);
  let top = Math.ceil(hi / step) * step;
  let bot = kind === "bar" ? 0 : Math.floor(lo / step) * step;
  if (clamp) { top = Math.min(top, clamp[1]); bot = Math.max(bot, clamp[0]); }
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - bot) / (top - bot));
  const x = (i: number) => padL + slot * i + slot / 2;
  const ticks: number[] = [];
  for (let t = bot; t <= top + 1e-9; t += step) ticks.push(t);
  const bw = Math.max(1.5, Math.min(26, slot * (n > 60 ? 0.85 : 0.68)));
  const lbl = (b: Bucket, i: number) => {
    if (agg === "M") return fromYmd(b.start).toLocaleDateString("en-IE", { month: "short" });
    if (agg === "D" && n <= 7) return fromYmd(b.start).toLocaleDateString("en-IE", { weekday: "short" });
    const every = Math.ceil(n / (wide ? 10 : 5));
    return (n - 1 - i) % every === 0 ? fromYmd(b.start).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "";
  };
  // Line: join recorded days; a gap of missing days breaks it only when grouping by day over a long stretch
  const path = kind === "line" ? buckets.map((b, i) => (b.avg == null ? null : `${x(i).toFixed(1)},${y(b.avg).toFixed(1)}`)).filter(Boolean).map((pt, i) => `${i ? "L" : "M"}${pt}`).join(" ") : "";
  const dots = kind === "line" && n <= 120;

  return (
    <svg className="chart ntr-chart" viewBox={`0 0 ${W} ${H}`} {...bind} role="img" aria-label={`${title} by ${agg === "D" ? "day" : agg === "W" ? "week" : "month"}`}>
      {band && <rect x={padL} width={W - padL - padR} y={y(Math.min(band[1], top))} height={Math.max(0, y(Math.max(band[0], bot)) - y(Math.min(band[1], top)))} fill="var(--in)" opacity={0.12} />}
      {ticks.map((t) => (
        <g key={t}>
          <line className="axis" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} opacity={t === bot ? 1 : 0.5} strokeDasharray={t === bot ? undefined : "3 3"} />
          <text x={W - padR + 4} y={y(t) + 4}>{axis(t)}</text>
        </g>
      ))}
      {target != null && target <= top && <line className="ntr-target" x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} />}
      {buckets.map((b, i) => (
        <g key={b.key} opacity={active != null && active !== i ? 0.45 : 1}>
          <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
          {kind === "bar" && b.avg != null && (
            <rect x={x(i) - bw / 2} width={bw} y={y(b.avg)} height={Math.max(1, y(0) - y(b.avg))} rx={Math.min(2, bw / 3)} className={`${barClass?.(b.avg) ?? ""}${b.end >= today && b.start <= today ? " today" : ""}`} fill={barClass ? undefined : color} />
          )}
          <text x={x(i)} y={H - 6} textAnchor="middle">{lbl(b, i)}</text>
        </g>
      ))}
      {kind === "line" && <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} pointerEvents="none" />}
      {kind === "line" && buckets.map((b, i) => b.avg != null && (dots || active === i) && (
        <circle key={b.key} cx={x(i)} cy={y(b.avg)} r={active === i ? 5 : n > 45 ? 2.2 : 3.5} fill={color} pointerEvents="none" />
      ))}
      {active != null && buckets[active] && <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--ink)" strokeWidth={1} opacity={0.3} pointerEvents="none" />}
    </svg>
  );
}
