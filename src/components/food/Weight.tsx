import { useMemo, useRef, useState } from "react";
import type { Checkin } from "../../lib/readiness";
import { PHASE_LABEL, PHASE_RATE, latestPhase } from "../../lib/readiness";
import type { NutritionData, TrendPoint } from "../../lib/nutrition";
import { addDays, bodyFatSeries, deleteBodyFat, deleteWeight, fromYmd, loadNutrition, saveBodyFat, saveWeight, todayYmd, trendWeights, weeklyRate } from "../../lib/nutrition";
import { startOfWeek } from "../../lib/dates";
import { useDesktop } from "../../lib/desktop";
import type { Pinch } from "../../lib/chartGestures";
import { daysApart, pinchWindow, useChartGestures } from "../../lib/chartGestures";
import { num } from "./bits";

const short = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
const kg = (v: number) => v.toFixed(1);
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;
const fmtD = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
const fmtLong = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** What a chart measures. sparse: readings weeks apart (body fat), drawn as dots joined by straight lines. */
export interface ChartUnit { suffix: string; scale: string; trend: string; aria: string; sparse?: boolean }
const KG: ChartUnit = { suffix: " kg", scale: "", trend: "trend", aria: "Bodyweight" };
const BF: ChartUnit = { suffix: "%", scale: "measured", trend: "between readings", aria: "Body fat", sparse: true };

type Agg = "D" | "W" | "M";
interface ChartPt { day: string; label: string; scale: number | null; trend: number }

/** Group days into weeks or months: scale is the average weigh-in, trend the average trend. */
function aggregate(points: TrendPoint[], agg: Agg): ChartPt[] {
  if (agg === "D") return points.map((p) => ({ day: p.day, label: p.day, scale: p.scale, trend: p.trend }));
  const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const key = (d: string) => (agg === "W" ? ymdOf(startOfWeek(fromYmd(d))) : d.slice(0, 7) + "-01");
  const out: ChartPt[] = [];
  let cur: { k: string; s: number[]; t: number[] } | null = null;
  const flush = () => { if (cur) out.push({ day: cur.k, label: cur.k, scale: cur.s.length ? cur.s.reduce((a, b) => a + b, 0) / cur.s.length : null, trend: cur.t.reduce((a, b) => a + b, 0) / cur.t.length }); };
  for (const p of points) {
    const k = key(p.day);
    if (!cur || cur.k !== k) { flush(); cur = { k, s: [], t: [] }; }
    if (p.scale != null) cur.s.push(p.scale);
    cur.t.push(p.trend);
  }
  flush();
  return out;
}

function niceStep(span: number) {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 0.01)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export type { Pinch } from "../../lib/chartGestures";

/** Scale weight as a light line, trend weight as the strong line (like MacroFactor, and the sleep chart). */
export function WeightChart({ points, compact, agg = "D", show = { scale: true, trend: true }, unit = KG, onPinch }: { points: TrendPoint[]; compact?: boolean; agg?: Agg; show?: { scale: boolean; trend: boolean }; unit?: ChartUnit; onPinch?: (p: Pinch) => void }) {
  const wide = useDesktop();
  const [hover, setHover] = useState<number | null>(null);
  // Drag along the timeline, hold to read a day, pinch to zoom (the weight axis rescales to what's visible)
  const pickRef = useRef<(x: number) => void>(() => {});
  const { bind, rect } = useChartGestures({
    disabled: compact,
    onPinch,
    read: (x) => pickRef.current(x),
    clear: () => setHover(null),
    tap: (x, mouse) => (mouse ? pickRef.current(x) : setHover(null)), // a quick tap clears the reading
  });
  const pts = aggregate(points, agg);
  if (pts.length < 2) return null;
  const W = wide && !compact ? 760 : 340, H = compact ? 130 : wide ? 260 : 200, padL = 6, padR = 34, padB = 22, padT = 12;
  const vals = pts.flatMap((p) => [...(show.scale && p.scale != null ? [p.scale] : []), ...(show.trend ? [p.trend] : [])]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const step = niceStep(Math.max(hi - lo, 1));
  const v0 = Math.floor(lo / step) * step - (lo % step === 0 ? step : 0), v1 = Math.ceil(hi / step) * step;
  const n = pts.length - 1;
  const x = (i: number) => padL + (i / n) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - v0) / (v1 - v0 || 1));
  const trendPath = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.trend).toFixed(1)}`).join(" ");
  const scalePts = pts.map((p, i) => (p.scale != null ? [x(i), y(p.scale)] : null)).filter((q): q is number[] => q != null);
  const scalePath = scalePts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const ticks: number[] = [];
  for (let v = v0; v <= v1 + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const nLabels = wide && !compact ? 8 : compact ? 3 : 5;
  const xt = Array.from(new Set(Array.from({ length: nLabels }, (_, k) => Math.round((k / (nLabels - 1)) * n))));
  const fmtX = (d: string) => fromYmd(d).toLocaleDateString("en-IE", agg === "M" || n > 400 ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  pickRef.current = (clientX: number) => {
    const r = rect();
    if (!r) return;
    const vx = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n, Math.round(((vx - padL) / (W - padL - padR)) * n))));
  };
  const hp = hover != null ? pts[hover] : null;
  const dotR = unit.sparse ? 3.4 : pts.length <= 45 ? (compact ? 2 : 2.6) : 0;
  const val = (v: number) => `${kg(v)}${unit.suffix}`;
  return (
    <div className="wchart">
      {!compact && (
        <div className="wchart-read small">
          {hp ? (
            <>
              <strong>{agg === "D" ? fmtLong(hp.day) : agg === "W" ? `Week of ${fromYmd(hp.day).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}` : fromYmd(hp.day).toLocaleDateString("en-IE", { month: "long", year: "numeric" })}</strong>
              {unit.sparse ? (
                hp.scale != null ? <span><i className="leg-dot" />{val(hp.scale)} {agg !== "D" ? "measured (avg)" : unit.scale}</span> : <span><i className="leg-line trend" />≈ {val(hp.trend)} {unit.trend}</span>
              ) : (
                <>
                  {hp.scale != null && <span><i className="leg-line scale" />{val(hp.scale)}{agg !== "D" ? " avg" : ""}</span>}
                  <span><i className="leg-line trend" />{val(hp.trend)} {unit.trend}</span>
                </>
              )}
            </>
          ) : <span className="muted">{wide ? "Hover to read a day; drag to move, pinch or ctrl + scroll to zoom" : "Hold to read a day · drag to move · pinch to zoom"}</span>}
        </div>
      )}
      <svg
        className="chart wchart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${unit.aria}: ${val(pts[n].trend)}`}
        {...bind}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="axis" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} strokeDasharray="3 4" opacity={0.7} />
            <text x={W - padR + 5} y={y(v) + 4}>{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        ))}
        {xt.map((i, k) => <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"}>{fmtX(pts[i].day)}</text>)}
        {show.scale && !unit.sparse && scalePts.length > 1 && <path d={scalePath} fill="none" className="w-scale" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
        {show.trend && <path d={trendPath} fill="none" className="w-trend" strokeWidth={compact ? 2.2 : 2.6} strokeLinejoin="round" strokeLinecap="round" />}
        {show.scale && dotR > 0 && scalePts.map(([a, b], i) => <circle key={i} cx={a} cy={b} r={dotR} className={`w-scale-dot${unit.sparse ? " solid" : ""}`} />)}
        {hp && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={H - padB} className="w-guide" />
            {show.trend && <circle cx={x(hover!)} cy={y(hp.trend)} r={4} className="w-trend-dot" />}
            {show.scale && hp.scale != null && <circle cx={x(hover!)} cy={y(hp.scale)} r={3.5} className="w-scale-dot on" />}
          </g>
        )}
      </svg>
    </div>
  );
}

function rateVerdict(ratePct: number, checkins: Checkin[]) {
  const phase = latestPhase(checkins);
  if (!phase) return null;
  const b = PHASE_RATE[phase];
  const where = ratePct < b.lo ? (phase === "surplus" ? "slower than" : "faster than") : ratePct > b.hi ? (phase === "deficit" ? "slower than" : "faster than") : "on";
  return `${where === "on" ? "On" : where[0].toUpperCase() + where.slice(1)} target for ${PHASE_LABEL[phase].toLowerCase()} (${b.text}).`;
}

type Range = 7 | 30 | 91 | 182 | 365 | 0;
const RANGES: { r: Range; l: string }[] = [{ r: 7, l: "1W" }, { r: 30, l: "1M" }, { r: 91, l: "3M" }, { r: 182, l: "6M" }, { r: 365, l: "1Y" }, { r: 0, l: "All" }];

const autoAgg = (days: number): Agg => (days > 500 ? "M" : days > 120 ? "W" : "D");

/** The date window a chart shows: a preset range ending today (‹ › step through it), or a custom window set by
 *  pinching or dragging the chart. */
function useTimeWindow(first: string, last: string, initial: Range) {
  const [range, setRange] = useState<Range>(initial);
  const [aggPick, setAggPick] = useState<Agg | null>(null);
  const [anchor, setAnchor] = useState(last);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const gesture = useRef<{ start: string; end: string } | null>(null);
  const rangeStart = range ? (addDays(anchor, -(range - 1)) < first ? first : addDays(anchor, -(range - 1))) : first;
  const start = custom?.start ?? rangeStart;
  const end = custom?.end ?? anchor;
  const span = Math.max(1, daysApart(start, end));
  const zoomed = custom != null && (!range || span !== range - 1); // dragging along keeps the preset; pinching doesn't
  const onPinch = (p: Pinch) => {
    if (p.phase === "start") { gesture.current = { start, end }; return; }
    if (p.phase === "end") { gesture.current = null; return; }
    const g = gesture.current;
    if (!g) return;
    setCustom(pinchWindow(g, p, first, last));
    setAggPick(null);
  };
  const shift = (dir: -1 | 1) => {
    if (custom) {
      const total = daysApart(first, last);
      let s = daysApart(first, custom.start) + dir * span;
      s = Math.max(0, Math.min(total - span, s));
      setCustom({ start: addDays(first, s), end: addDays(first, s + span) });
      return;
    }
    if (!range) return;
    let n = addDays(anchor, dir * range);
    if (n > last) n = last;
    if (addDays(n, -(range - 1)) < first) n = addDays(first, range - 1) > last ? last : addDays(first, range - 1);
    setAnchor(n);
  };
  const pickRange = (r: Range) => { setRange(r); setAnchor(last); setCustom(null); setAggPick(null); };
  return { range, pickRange, aggPick, setAggPick, start, end, zoomed, onPinch, shift, canShift: !!range || custom != null, first, last };
}
type TimeWindow = ReturnType<typeof useTimeWindow>;

function WindowNav({ w }: { w: TimeWindow }) {
  return (
    <div className="ntr-range">
      <button className="icon-btn" aria-label="Earlier" disabled={!w.canShift || w.start <= w.first} onClick={() => w.shift(-1)}>‹</button>
      <span className="small">{fmtD(w.start)} – {fmtD(w.end)}{w.zoomed && <span className="muted"> · zoomed</span>}</span>
      <button className="icon-btn" aria-label="Later" disabled={!w.canShift || w.end >= w.last} onClick={() => w.shift(1)}>›</button>
    </div>
  );
}

function WindowControls({ w, agg }: { w: TimeWindow; agg: Agg }) {
  return (
    <div className="ntr-controls">
      <div className="seg ntr-ranges" role="group" aria-label="Range">
        {RANGES.map(({ r, l }) => <button key={l} className={w.range === r && !w.zoomed ? "on" : ""} aria-pressed={w.range === r && !w.zoomed} onClick={() => w.pickRange(r)}>{l}</button>)}
      </div>
      <select className="input ntr-agg" value={agg} onChange={(e) => w.setAggPick(e.target.value as Agg)} aria-label="Granularity">
        <option value="D">Days</option>
        <option value="W">Weeks</option>
        <option value="M">Months</option>
      </select>
    </div>
  );
}

/** Weight page: weigh in, scale vs trend with ranges and granularity, insights, weigh-ins, body fat. */
export default function WeightView({ nutri, checkins, setNutri, onClose, embedded }: { nutri: NutritionData; checkins: Checkin[]; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose?: () => void; embedded?: boolean }) {
  const today = todayYmd();
  const [day, setDay] = useState(today);
  const existing = nutri.weights.find((w) => w.measured_on === day);
  const [val, setVal] = useState(existing ? String(existing.weight_kg) : "");
  const [show, setShow] = useState({ scale: true, trend: true });
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pts = useMemo(() => trendWeights(nutri.weights), [nutri.weights]);
  const win = useTimeWindow(pts[0]?.day ?? today, today, 91);
  const shown = pts.filter((p) => p.day >= win.start && p.day <= win.end);
  const agg: Agg = win.aggPick ?? autoAgg(shown.length);
  const last = pts[pts.length - 1];
  const rate = weeklyRate(pts);
  const trendAt = (back: number) => pts[pts.length - 1 - back]?.trend;
  const v = num(val);
  const avg = shown.length ? shown.reduce((a, p) => a + p.trend, 0) / shown.length : null;
  const diff = shown.length > 1 ? shown[shown.length - 1].trend - shown[0].trend : null;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      const fresh = await loadNutrition();
      setNutri(() => fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const pickDay = (d: string) => {
    setDay(d);
    const w = nutri.weights.find((x) => x.measured_on === d);
    setVal(w ? String(w.weight_kg) : "");
  };
  const changes = [3, 7, 14, 30, 90].map((d) => ({ d, v: last && trendAt(d) != null ? last.trend - trendAt(d)! : null }));

  return (
    <>
      {!embedded && (
        <div className="editor-bar">
          <div>
            <h1>Weight</h1>
            <p className="muted small">The light line is your scale weight; the strong line is your trend.</p>
          </div>
          {onClose && <button className="btn ghost" onClick={onClose}>Done</button>}
        </div>
      )}

      <section className="panel weigh-row">
        <form className="weigh-form" onSubmit={(e) => { e.preventDefault(); if (v != null) act(() => saveWeight(day, Math.round(v * 10) / 10)); }}>
          <label className="field"><span>Day</span><input className="input" type="date" value={day} max={today} onChange={(e) => pickDay(e.target.value)} /></label>
          <label className="field"><span>Scale weight (kg)</span><input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. 78.2" /></label>
          <button className="btn primary" disabled={busy || v == null || v < 25 || v > 350}>{busy ? "…" : existing ? "Update" : "Save"}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {pts.length > 1 ? (
        <section className="panel section wpanel">
          <div className="w-head">
            <div><span className="small muted">Average</span><span className="w-big num">{avg != null ? kg(avg) : "–"}<small> kg</small></span></div>
            <div><span className="small muted">Difference</span><span className="w-big num">{diff != null ? signed(diff) : "–"}<small> kg</small></span></div>
          </div>
          <WindowNav w={win} />
          <WeightChart points={shown} agg={agg} show={show} onPinch={win.onPinch} />
          <WindowControls w={win} agg={agg} />
          <div className="ntr-legend" role="group" aria-label="Show">
            <button className={`ntr-leg${show.scale ? " on" : ""}`} aria-pressed={show.scale} onClick={() => setShow((s) => ({ ...s, scale: !s.scale || !s.trend ? true : false }))}><i className="leg-line scale" />Scale weight</button>
            <button className={`ntr-leg${show.trend ? " on" : ""}`} aria-pressed={show.trend} onClick={() => setShow((s) => ({ ...s, trend: !s.trend || !s.scale ? true : false }))}><i className="leg-line trend" />Trend weight</button>
          </div>
        </section>
      ) : (
        <div className="empty section"><p>Log a few mornings and your trend appears here.</p></div>
      )}

      {last && (
        <div className="cols section">
          <div className="col">
            <section className="panel">
              <h2 style={{ marginBottom: 6 }}>Weight changes</h2>
              {changes.map(({ d, v: c }) => (
                <div key={d} className="wchange">
                  <span className="small">{d}-day</span>
                  <span className="num"><strong>{c != null ? `${signed(c, 2)} kg` : "–"}</strong></span>
                  <span className={`small ${c == null ? "muted" : c < -0.05 ? "down" : c > 0.05 ? "up" : "muted"}`}>{c == null ? "" : c < -0.05 ? "↘ Decrease" : c > 0.05 ? "↗ Increase" : "→ Steady"}</span>
                </div>
              ))}
            </section>
          </div>
          <div className="col">
            <section className="panel winsights">
              <div><span className="w-big num">{kg(last.trend)}<small> kg</small></span><span className="small"><strong>Current weight.</strong> <span className="muted">Your trend: the estimate of your true weight with day-to-day swings smoothed out.</span></span></div>
              {rate && <div><span className="w-big num">{signed(rate.kg, 2)}<small> kg/wk</small></span><span className="small"><strong>Weekly change.</strong> <span className="muted">Over the past three weeks ({signed(rate.pct, 2)}% of bodyweight).</span>{rateVerdict(rate.pct, checkins) && <span style={{ display: "block" }}>{rateVerdict(rate.pct, checkins)}</span>}</span></div>}
              {rate && <div><span className="w-big num">{kg(last.trend + (rate.kg * 30) / 7)}<small> kg</small></span><span className="small"><strong>30-day projection.</strong> <span className="muted">If the current rate holds.</span></span></div>}
            </section>
          </div>
        </div>
      )}

      <BodyFatSection nutri={nutri} setNutri={setNutri} weightPts={pts} />

      {nutri.weights.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 8 }}>Weigh-ins</h2>
          <div className="panel list-panel">
            {[...nutri.weights].reverse().slice(0, all ? undefined : 30).map((w) => {
              const t = pts.find((p) => p.day === w.measured_on)?.trend;
              return (
                <div key={w.id} className="list-row">
                  <button className="rec-main" onClick={() => { pickDay(w.measured_on); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <strong className="num">{kg(w.weight_kg)} kg</strong> <span className="muted small">{fmtLong(w.measured_on)}</span>
                    {t != null && <span className="small muted" style={{ display: "block" }}>trend {kg(t)}</span>}
                  </button>
                  <button className="link small" disabled={busy} onClick={() => act(() => deleteWeight(w.id))}>Delete</button>
                </div>
              );
            })}
          </div>
          {!all && nutri.weights.length > 30 && <button className="link small" style={{ marginTop: 8 }} onClick={() => setAll(true)}>Show all {nutri.weights.length}</button>}
        </section>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>Readiness scans with a weight add it here too. Tap a weigh-in to change it.</p>
    </>
  );
}

/** Body fat readings (a scan, calipers or a visual estimate) are weeks apart: dots joined by straight lines, with
 *  the same ranges, zoom and drag as the weight chart. */
function BodyFatSection({ nutri, setNutri, weightPts }: { nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; weightPts: TrendPoint[] }) {
  const today = todayYmd();
  const [day, setDay] = useState(today);
  const existing = nutri.bodyFats.find((b) => b.measured_on === day);
  const [val, setVal] = useState(existing ? String(existing.body_fat_pct) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const pts = useMemo(() => bodyFatSeries(nutri.bodyFats), [nutri.bodyFats]);
  const win = useTimeWindow(pts[0]?.day ?? today, today, 0);
  const shown = pts.filter((p) => p.day >= win.start && p.day <= win.end);
  const agg: Agg = win.aggPick ?? "D"; // only a handful of readings, so days read best at any range
  const readings = [...nutri.bodyFats].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const latest = readings[readings.length - 1];
  const inWin = readings.filter((r) => r.measured_on >= win.start && r.measured_on <= win.end);
  const change = inWin.length > 1 ? inWin[inWin.length - 1].body_fat_pct - inWin[0].body_fat_pct : null;
  // Fat and lean mass at the latest reading, using that day's trend weight
  const wt = latest ? weightPts.find((p) => p.day === latest.measured_on)?.trend : undefined;
  const fatKg = latest && wt != null ? (wt * latest.body_fat_pct) / 100 : null;
  const v = num(val);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      const fresh = await loadNutrition();
      setNutri(() => fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  const pickDay = (d: string) => {
    setDay(d);
    const b = nutri.bodyFats.find((x) => x.measured_on === d);
    setVal(b ? String(b.body_fat_pct) : "");
  };

  return (
    <section className="section bf-section">
      <h2 style={{ marginBottom: 8 }}>Body fat</h2>
      <section className="panel weigh-row">
        <form className="weigh-form" onSubmit={(e) => { e.preventDefault(); if (v != null) act(() => saveBodyFat(day, Math.round(v * 10) / 10)); }}>
          <label className="field"><span>Day</span><input className="input" type="date" value={day} max={today} onChange={(e) => pickDay(e.target.value)} /></label>
          <label className="field"><span>Body fat (%)</span><input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. 21.3" /></label>
          <button className="btn primary" disabled={busy || v == null || v <= 2 || v >= 70}>{busy ? "…" : existing ? "Update" : "Save"}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {pts.length > 1 ? (
        <section className="panel section wpanel bf">
          <div className="w-head">
            <div><span className="small muted">Latest</span><span className="w-big num">{latest ? kg(latest.body_fat_pct) : "–"}<small> %</small></span></div>
            <div><span className="small muted">Change</span><span className="w-big num">{change != null ? signed(change) : "–"}<small> %</small></span></div>
            {fatKg != null && wt != null && <div><span className="small muted">Lean mass</span><span className="w-big num">{kg(wt - fatKg)}<small> kg</small></span></div>}
          </div>
          <WindowNav w={win} />
          {shown.length > 1 ? <WeightChart points={shown} agg={agg} unit={BF} onPinch={win.onPinch} /> : <p className="muted small" style={{ padding: "40px 0", textAlign: "center" }}>No readings in this range.</p>}
          <WindowControls w={win} agg={agg} />
          <div className="ntr-legend">
            <span className="ntr-leg on"><i className="leg-dot" />Readings</span>
            <span className="ntr-leg on"><i className="leg-line trend" />Between readings</span>
          </div>
          {fatKg != null && wt != null && latest && (
            <p className="muted small" style={{ marginTop: 8 }}>At your last reading ({fmtD(latest.measured_on)}): about {kg(fatKg)} kg fat and {kg(wt - fatKg)} kg lean mass, from a trend weight of {kg(wt)} kg.</p>
          )}
        </section>
      ) : (
        <div className="empty section"><p>{readings.length ? "Log another reading to see your body fat over time." : "Log a reading from a scan, calipers or a visual estimate."}</p></div>
      )}

      {readings.length > 0 && (
        <div className="panel list-panel section">
          {[...readings].reverse().slice(0, all ? undefined : 10).map((b, i) => {
            const prev = readings[readings.length - 2 - i];
            return (
              <div key={b.id} className="list-row">
                <button className="rec-main" onClick={() => pickDay(b.measured_on)}>
                  <strong className="num">{kg(b.body_fat_pct)}%</strong> <span className="muted small">{fmtLong(b.measured_on)}</span>
                  {prev && <span className="small muted" style={{ display: "block" }}>{signed(b.body_fat_pct - prev.body_fat_pct)} since {short(prev.measured_on)}</span>}
                </button>
                <button className="link small" disabled={busy} onClick={() => act(() => deleteBodyFat(b.id))}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
      {!all && readings.length > 10 && <button className="link small" style={{ marginTop: 8 }} onClick={() => setAll(true)}>Show all {readings.length}</button>}
    </section>
  );
}
