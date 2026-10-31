import { useMemo, useState } from "react";
import type { Checkin } from "../../lib/readiness";
import { PHASE_LABEL, PHASE_RATE, latestPhase } from "../../lib/readiness";
import type { NutritionData, TrendPoint } from "../../lib/nutrition";
import { deleteWeight, fromYmd, loadNutrition, saveWeight, todayYmd, trendWeights, weeklyRate } from "../../lib/nutrition";
import { num } from "./bits";

const short = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
const kg = (v: number) => v.toFixed(1);
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/** Scale weights as dots, trend weight as the line. */
export function WeightChart({ points, compact }: { points: TrendPoint[]; compact?: boolean }) {
  if (points.length < 2) return null;
  const W = 340, H = compact ? 120 : 180, padL = 34, padB = 22, padT = 10, padR = 8;
  const vals = points.flatMap((p) => (p.scale != null ? [p.scale, p.trend] : [p.trend]));
  let v0 = Math.min(...vals), v1 = Math.max(...vals);
  const pad = Math.max((v1 - v0) * 0.15, 0.3);
  v0 -= pad; v1 += pad;
  const n = points.length - 1;
  const x = (i: number) => padL + (i / n) * (W - padL - padR);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - v0) / (v1 - v0));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.trend).toFixed(1)}`).join(" ");
  const ticks = [v0 + (v1 - v0) * 0.2, (v0 + v1) / 2, v1 - (v1 - v0) * 0.2];
  const xt = [0, Math.round(n / 2), n];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bodyweight: trend ${kg(points[n].trend)} kg`}>
      {ticks.map((v, i) => (
        <g key={i}>
          <line className="axis" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} opacity={0.6} />
          <text x={padL - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(1)}</text>
        </g>
      ))}
      {xt.map((i, k) => <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{short(points[i].day)}</text>)}
      {points.map((p, i) => p.scale != null && (
        <circle key={i} cx={x(i)} cy={y(p.scale)} r={compact ? 2.5 : 3.2} className="w-dot"><title>{`${short(p.day)}: ${kg(p.scale)} kg on the scale, trend ${kg(p.trend)}`}</title></circle>
      ))}
      <path d={line} fill="none" className="w-line" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function rateVerdict(ratePct: number, checkins: Checkin[]) {
  const phase = latestPhase(checkins);
  if (!phase) return null;
  const b = PHASE_RATE[phase];
  const where = ratePct < b.lo ? (phase === "surplus" ? "slower than" : "faster than") : ratePct > b.hi ? (phase === "deficit" ? "slower than" : "faster than") : "on";
  return `${where === "on" ? "On" : where[0].toUpperCase() + where.slice(1)} target for ${PHASE_LABEL[phase].toLowerCase()} (${b.text}).`;
}

/** Small card for the Food page: today's weigh-in and the trend. */
export function WeightCard({ nutri, checkins, setNutri, onOpen }: { nutri: NutritionData; checkins: Checkin[]; setNutri: (f: (n: NutritionData) => NutritionData) => void; onOpen: () => void }) {
  const pts = useMemo(() => trendWeights(nutri.weights), [nutri.weights]);
  const today = todayYmd();
  const todays = nutri.weights.find((w) => w.measured_on === today);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = weeklyRate(pts);
  const last = pts[pts.length - 1];
  const v = num(val);

  async function save() {
    if (v == null || v < 25 || v > 350) return;
    setBusy(true);
    setError(null);
    try {
      await saveWeight(today, Math.round(v * 10) / 10);
      const fresh = await loadNutrition();
      setNutri(() => fresh);
      setVal("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel weight-card">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <h2>Weight</h2>
        <button className="link small" onClick={onOpen}>{pts.length ? "Trend ›" : "History ›"}</button>
      </div>
      {last ? (
        <div className="w-figs">
          <div><span className="w-big num">{kg(last.trend)}</span><span className="muted small"> kg trend</span></div>
          <div className="small">
            {todays ? <>Scale today <strong className="num">{kg(todays.weight_kg)}</strong></> : <span className="muted">No weigh-in today</span>}
            {rate && <span className="muted" style={{ display: "block" }}>{signed(rate.kg, 2)} kg a week</span>}
          </div>
        </div>
      ) : (
        <p className="muted small">Weigh in each morning, after the loo and before food. The trend line smooths out water and salt swings.</p>
      )}
      {pts.length > 1 && <WeightChart points={pts.slice(-30)} compact />}
      {!todays && (
        <form className="w-input" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Today's weight, kg" aria-label="Today's weight in kg" />
          <button className="btn dark" disabled={busy || v == null || v < 25 || v > 350}>{busy ? "…" : "Save"}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {rate && rateVerdict(rate.pct, checkins) && <p className="muted small" style={{ marginTop: 6 }}>{rateVerdict(rate.pct, checkins)}</p>}
    </section>
  );
}

type Range = 30 | 90 | 0;

/** Full weight page: log any day, scale vs trend over time, entries. */
export default function WeightView({ nutri, checkins, setNutri, onClose, embedded }: { nutri: NutritionData; checkins: Checkin[]; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose?: () => void; embedded?: boolean }) {
  const [day, setDay] = useState(todayYmd());
  const existing = nutri.weights.find((w) => w.measured_on === day);
  const [val, setVal] = useState(existing ? String(existing.weight_kg) : "");
  const [range, setRange] = useState<Range>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pts = useMemo(() => trendWeights(nutri.weights), [nutri.weights]);
  const shown = range ? pts.slice(-range) : pts;
  const last = pts[pts.length - 1];
  const rate = weeklyRate(pts);
  const at = (back: number) => pts[pts.length - 1 - back]?.trend;
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
    const w = nutri.weights.find((x) => x.measured_on === d);
    setVal(w ? String(w.weight_kg) : "");
  };

  return (
    <>
      {!embedded && (
        <div className="editor-bar">
          <div>
            <h1>Weight</h1>
            <p className="muted small">Dots are scale weights; the line is your trend.</p>
          </div>
          {onClose && <button className="btn ghost" onClick={onClose}>Done</button>}
        </div>
      )}

      <div className="cols">
        <div className="col">
          <section className="panel">
            <form className="grid c2" onSubmit={(e) => { e.preventDefault(); if (v != null) act(() => saveWeight(day, Math.round(v * 10) / 10)); }}>
              <label className="field"><span>Day</span><input className="input" type="date" value={day} max={todayYmd()} onChange={(e) => pickDay(e.target.value)} /></label>
              <label className="field"><span>Scale weight (kg)</span><input className="input" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. 78.2" /></label>
              <button className="btn primary" style={{ gridColumn: "1 / -1" }} disabled={busy || v == null || v < 25 || v > 350}>{busy ? "Saving…" : existing ? "Update weigh-in" : "Save weigh-in"}</button>
            </form>
            {error && <p className="error">{error}</p>}
          </section>

          {last && (
            <div className="stats">
              <div className="stat"><div className="v num">{kg(last.trend)}</div><div className="l">trend kg</div></div>
              <div className="stat"><div className="v num">{at(7) != null ? signed(last.trend - at(7)!) : "–"}</div><div className="l">last 7 days</div></div>
              <div className="stat"><div className="v num">{rate ? signed(rate.pct, 2) + "%" : "–"}</div><div className="l">a week{rate ? ` (${rate.over} days)` : ""}</div></div>
            </div>
          )}
          {rate && rateVerdict(rate.pct, checkins) && <p className="muted small" style={{ marginTop: 8 }}>{rateVerdict(rate.pct, checkins)}</p>}
        </div>

        <div className="col">
          {pts.length > 1 ? (
            <section className="panel">
              <div className="page-head" style={{ marginBottom: 6 }}>
                <h2>Scale vs trend</h2>
                <div className="seg" role="group" aria-label="Range" style={{ minWidth: 170 }}>
                  {([30, 90, 0] as Range[]).map((r) => <button key={r} className={range === r ? "on" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>{r ? `${r}d` : "All"}</button>)}
                </div>
              </div>
              <WeightChart points={shown} />
              <p className="chart-note">The trend moves 10% of the way towards each day's weight, so one salty dinner or a big training day barely shifts it. Judge progress by the line, not the dots.</p>
            </section>
          ) : (
            <div className="empty"><p>Log a few mornings and your trend appears here.</p></div>
          )}
        </div>
      </div>

      {nutri.weights.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 8 }}>Weigh-ins</h2>
          <div className="panel list-panel">
            {[...nutri.weights].reverse().slice(0, 60).map((w) => {
              const t = pts.find((p) => p.day === w.measured_on)?.trend;
              return (
                <div key={w.id} className="list-row">
                  <button className="rec-main" onClick={() => pickDay(w.measured_on)}>
                    <strong className="num">{kg(w.weight_kg)} kg</strong> <span className="muted small">{fromYmd(w.measured_on).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</span>
                    {t != null && <span className="small muted" style={{ display: "block" }}>trend {kg(t)}</span>}
                  </button>
                  <button className="link small" disabled={busy} onClick={() => act(() => deleteWeight(w.id))}>Delete</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>Readiness scans with a weight add it here too. Tap a weigh-in to change it.</p>
    </>
  );
}
