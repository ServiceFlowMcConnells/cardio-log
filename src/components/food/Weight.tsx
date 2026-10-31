import { useEffect, useMemo, useRef, useState } from "react";
import type { Checkin } from "../../lib/readiness";
import { PHASE_LABEL, PHASE_RATE, latestPhase } from "../../lib/readiness";
import type { NutritionData, TrendPoint } from "../../lib/nutrition";
import { addDays, deleteWeight, fromYmd, loadNutrition, saveWeight, todayYmd, trendWeights, weeklyRate } from "../../lib/nutrition";
import { startOfWeek } from "../../lib/dates";
import { useDesktop } from "../../lib/desktop";
import { num } from "./bits";

const short = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
const kg = (v: number) => v.toFixed(1);
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

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

/** Scale weight as a light line, trend weight as the strong line (like MacroFactor, and the sleep chart). Tap or
 *  drag across it to read a day. */
export type Pinch = { phase: "start" | "move" | "end"; scale: number; center: number; shift: number }; // center/shift as fractions of the plot width

export function WeightChart({ points, compact, agg = "D", show = { scale: true, trend: true }, onPinch }: { points: TrendPoint[]; compact?: boolean; agg?: Agg; show?: { scale: boolean; trend: boolean }; onPinch?: (p: Pinch) => void }) {
  const wide = useDesktop();
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  // Two-finger pinch zooms the time axis (the weight axis rescales to what's visible)
  const touches = useRef(new Map<number, number>());
  const pinch0 = useRef<{ d: number; c: number } | null>(null);
  const frac = (clientX: number) => { const r = ref.current?.getBoundingClientRect(); return r ? (clientX - r.left) / r.width : 0.5; };
  const twoX = () => { const xs = [...touches.current.values()]; return xs.length >= 2 ? [xs[0], xs[1]] : null; };
  // Trackpad pinch (or ctrl + scroll) on a laptop; needs a non-passive listener to stop the page zooming
  const pinchRef = useRef(onPinch);
  pinchRef.current = onPinch;
  useEffect(() => {
    const el = ref.current;
    if (!el || compact) return;
    const onWheel = (e: WheelEvent) => {
      const f = pinchRef.current;
      if (!f || !e.ctrlKey) return;
      e.preventDefault();
      const c = frac(e.clientX);
      f({ phase: "start", scale: 1, center: c, shift: 0 });
      f({ phase: "move", scale: Math.exp(-e.deltaY / 150), center: c, shift: 0 });
      f({ phase: "end", scale: 1, center: c, shift: 0 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, points.length > 1]);
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
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n, Math.round(((vx - padL) / (W - padL - padR)) * n))));
  };
  const hp = hover != null ? pts[hover] : null;
  const dotR = pts.length <= 45 ? (compact ? 2 : 2.6) : 0;
  return (
    <div className="wchart">
      {!compact && (
        <div className="wchart-read small">
          {hp ? (
            <>
              <strong>{agg === "D" ? fromYmd(hp.day).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : agg === "W" ? `Week of ${fromYmd(hp.day).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}` : fromYmd(hp.day).toLocaleDateString("en-IE", { month: "long", year: "numeric" })}</strong>
              {hp.scale != null && <span><i className="leg-line scale" />{kg(hp.scale)} kg{agg !== "D" ? " avg" : ""}</span>}
              <span><i className="leg-line trend" />{kg(hp.trend)} kg trend</span>
            </>
          ) : <span className="muted">Tap the chart to read a day</span>}
        </div>
      )}
      <svg
        ref={ref}
        className="chart wchart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Bodyweight: trend ${kg(pts[n].trend)} kg`}
        onPointerDown={(e) => {
          if (compact) return;
          if (e.pointerType === "touch") {
            touches.current.set(e.pointerId, e.clientX);
            const t = twoX();
            if (t && onPinch) {
              pinch0.current = { d: Math.max(12, Math.abs(t[0] - t[1])), c: frac((t[0] + t[1]) / 2) };
              setHover(null);
              onPinch({ phase: "start", scale: 1, center: pinch0.current.c, shift: 0 });
              return;
            }
          }
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (compact) return;
          if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
            touches.current.set(e.pointerId, e.clientX);
            const t = twoX();
            if (t && pinch0.current && onPinch) {
              const c = frac((t[0] + t[1]) / 2);
              onPinch({ phase: "move", scale: Math.max(12, Math.abs(t[0] - t[1])) / pinch0.current.d, center: pinch0.current.c, shift: c - pinch0.current.c });
              return;
            }
          }
          if (e.buttons || e.pointerType === "mouse") pick(e.clientX);
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          if (pinch0.current && touches.current.size < 2) { pinch0.current = null; onPinch?.({ phase: "end", scale: 1, center: 0.5, shift: 0 }); }
        }}
        onPointerCancel={(e) => { touches.current.delete(e.pointerId); if (pinch0.current) { pinch0.current = null; onPinch?.({ phase: "end", scale: 1, center: 0.5, shift: 0 }); } }}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="axis" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} strokeDasharray="3 4" opacity={0.7} />
            <text x={W - padR + 5} y={y(v) + 4}>{Number.isInteger(v) ? v : v.toFixed(1)}</text>
          </g>
        ))}
        {xt.map((i, k) => <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"}>{fmtX(pts[i].day)}</text>)}
        {show.scale && scalePts.length > 1 && <path d={scalePath} fill="none" className="w-scale" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
        {show.scale && dotR > 0 && scalePts.map(([a, b], i) => <circle key={i} cx={a} cy={b} r={dotR} className="w-scale-dot" />)}
        {show.trend && <path d={trendPath} fill="none" className="w-trend" strokeWidth={compact ? 2.2 : 2.6} strokeLinejoin="round" strokeLinecap="round" />}
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
const daysApart = (a: string, b: string) => Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
const RANGES: { r: Range; l: string }[] = [{ r: 7, l: "1W" }, { r: 30, l: "1M" }, { r: 91, l: "3M" }, { r: 182, l: "6M" }, { r: 365, l: "1Y" }, { r: 0, l: "All" }];

/** Weight page: weigh in, scale vs trend with ranges and granularity, insights, weigh-ins. */
export default function WeightView({ nutri, checkins, setNutri, onClose, embedded }: { nutri: NutritionData; checkins: Checkin[]; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose?: () => void; embedded?: boolean }) {
  const today = todayYmd();
  const [day, setDay] = useState(today);
  const existing = nutri.weights.find((w) => w.measured_on === day);
  const [val, setVal] = useState(existing ? String(existing.weight_kg) : "");
  const [range, setRange] = useState<Range>(91);
  const [aggPick, setAggPick] = useState<Agg | null>(null);
  const [end, setEnd] = useState(today);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null); // set by pinching
  const gesture = useRef<{ start: string; end: string } | null>(null);
  const [show, setShow] = useState({ scale: true, trend: true });
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pts = useMemo(() => trendWeights(nutri.weights), [nutri.weights]);
  const first = pts[0]?.day ?? today;
  const rangeStart = range ? (addDays(end, -(range - 1)) < first ? first : addDays(end, -(range - 1))) : first;
  const start = custom?.start ?? rangeStart;
  const winEnd = custom?.end ?? end;
  const shown = pts.filter((p) => p.day >= start && p.day <= winEnd);
  const span = Math.max(1, daysApart(start, winEnd));

  function onPinch(p: Pinch) {
    if (p.phase === "start") { gesture.current = { start, end: winEnd }; return; }
    if (p.phase === "end") { gesture.current = null; return; }
    const g = gesture.current;
    if (!g) return;
    const total = Math.max(7, daysApart(first, today));
    const span0 = Math.max(1, daysApart(g.start, g.end));
    const span1 = Math.round(Math.max(6, Math.min(total, span0 / p.scale)));
    // Keep the day under the fingers' starting midpoint under their midpoint now
    const anchor = daysApart(first, g.start) + p.center * span0;
    let s = Math.round(anchor - (p.center + p.shift) * span1);
    s = Math.max(0, Math.min(total - span1, s));
    setCustom({ start: addDays(first, s), end: addDays(first, s + span1) });
    setAggPick(null);
  }
  const spanDays = shown.length;
  const agg: Agg = aggPick ?? (spanDays > 500 ? "M" : spanDays > 120 ? "W" : "D");
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
  const shift = (dir: -1 | 1) => {
    if (custom) {
      const total = daysApart(first, today);
      let s = daysApart(first, custom.start) + dir * span;
      s = Math.max(0, Math.min(total - span, s));
      setCustom({ start: addDays(first, s), end: addDays(first, s + span) });
      return;
    }
    if (!range) return;
    let n = addDays(end, dir * range);
    if (n > today) n = today;
    if (addDays(n, -(range - 1)) < first) n = addDays(first, range - 1) > today ? today : addDays(first, range - 1);
    setEnd(n);
  };
  const fmtD = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

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
          <div className="ntr-range">
            <button className="icon-btn" aria-label="Earlier" disabled={(!range && !custom) || start <= first} onClick={() => shift(-1)}>‹</button>
            <span className="small">{fmtD(start)} – {fmtD(winEnd)}{custom && <span className="muted"> · zoomed</span>}</span>
            <button className="icon-btn" aria-label="Later" disabled={(!range && !custom) || winEnd >= today} onClick={() => shift(1)}>›</button>
          </div>
          <WeightChart points={shown} agg={agg} show={show} onPinch={onPinch} />
          <div className="ntr-controls">
            <div className="seg ntr-ranges" role="group" aria-label="Range">
              {RANGES.map(({ r, l }) => <button key={l} className={range === r && !custom ? "on" : ""} aria-pressed={range === r && !custom} onClick={() => { setRange(r); setEnd(today); setCustom(null); setAggPick(null); }}>{l}</button>)}
            </div>
            <select className="input ntr-agg" value={agg} onChange={(e) => setAggPick(e.target.value as Agg)} aria-label="Granularity">
              <option value="D">Days</option>
              <option value="W">Weeks</option>
              <option value="M">Months</option>
            </select>
          </div>
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

      {nutri.weights.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 8 }}>Weigh-ins</h2>
          <div className="panel list-panel">
            {[...nutri.weights].reverse().slice(0, all ? undefined : 30).map((w) => {
              const t = pts.find((p) => p.day === w.measured_on)?.trend;
              return (
                <div key={w.id} className="list-row">
                  <button className="rec-main" onClick={() => { pickDay(w.measured_on); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <strong className="num">{kg(w.weight_kg)} kg</strong> <span className="muted small">{fromYmd(w.measured_on).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
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
