import { useMemo, useState } from "react";
import type { DayTotal, NutritionData } from "../../lib/nutrition";
import { addDays, dayTotals, fromYmd, targetFor, todayYmd } from "../../lib/nutrition";
import { fmtG, fmtKcal } from "./bits";
import { useDesktop } from "../../lib/desktop";

type Range = 7 | 30 | 91 | 182 | 365 | 0;
type Agg = "D" | "W" | "M";
type Series = "p" | "f" | "c" | "o";
const RANGES: { r: Range; label: string }[] = [{ r: 7, label: "1W" }, { r: 30, label: "1M" }, { r: 91, label: "3M" }, { r: 182, label: "6M" }, { r: 365, label: "1Y" }, { r: 0, label: "All" }];
const SERIES: { s: Series; label: string }[] = [{ s: "p", label: "Protein" }, { s: "f", label: "Fat" }, { s: "c", label: "Carbs" }, { s: "o", label: "Other" }];

interface Bucket {
  key: string;
  start: string;
  end: string;
  logged: DayTotal[]; // days with food logged
  planned: boolean; // all in the future: logged ahead
  avg: DayTotal | null;
  target: { kcal: number; protein: number | null; fat: number | null; carbs: number | null } | null;
}

const avgOf = (ds: DayTotal[]): DayTotal | null => {
  if (!ds.length) return null;
  const s = ds.reduce((a, d) => ({ kcal: a.kcal + d.kcal, protein: a.protein + d.protein, carbs: a.carbs + d.carbs, fat: a.fat + d.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  return { day: ds[0].day, entries: 0, kcal: s.kcal / ds.length, protein: s.protein / ds.length, carbs: s.carbs / ds.length, fat: s.fat / ds.length };
};
const mondayOf = (d: string) => { const x = fromYmd(d); return addDays(d, -((x.getDay() + 6) % 7)); };
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => fromYmd(d).toLocaleDateString("en-IE", o);
const kcalOther = (d: { kcal: number; protein: number; carbs: number; fat: number }) => Math.max(0, d.kcal - d.protein * 4 - d.carbs * 4 - d.fat * 9);

export default function NutritionTrends({ nutri, onOpenDay }: { nutri: NutritionData; onOpenDay: (day: string) => void }) {
  const today = todayYmd();
  const [range, setRange] = useState<Range>(7);
  const [aggPick, setAggPick] = useState<Agg | null>(null);
  const [end, setEnd] = useState(today);
  const [on, setOn] = useState<Set<Series>>(new Set(["p", "f", "c", "o"]));
  const [sel, setSel] = useState<number | null>(null);

  const totals = useMemo(() => dayTotals(nutri), [nutri]);
  const allDays = useMemo(() => [...totals.keys()].sort(), [totals]);
  const first = allDays[0] ?? today;
  const start = range ? addDays(end, -(range - 1)) : first;
  const agg: Agg = aggPick ?? (range === 0 ? (daysBetween(first, end) > 200 ? "M" : "W") : range >= 182 ? "W" : "D");

  const tgt = (d: string) => targetFor(nutri.targets, d);

  const buckets = useMemo(() => {
    const out: Bucket[] = [];
    const keyOf = (d: string) => (agg === "D" ? d : agg === "W" ? mondayOf(d) : d.slice(0, 7));
    let cur: { key: string; days: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const logged = cur.days.map((d) => totals.get(d)).filter((x): x is DayTotal => !!x && x.entries > 0);
      const ts = cur.days.map(tgt).filter((t): t is NonNullable<ReturnType<typeof tgt>> => !!t);
      const avgT = (k: "kcal" | "protein" | "fat" | "carbs") => { const v = ts.map((t) => t[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      out.push({ key: cur.key, start: cur.days[0], end: cur.days[cur.days.length - 1], logged, planned: cur.days[0] > today, avg: avgOf(logged), target: ts.length ? { kcal: avgT("kcal")!, protein: avgT("protein"), fat: avgT("fat"), carbs: avgT("carbs") } : null });
    };
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const k = keyOf(d);
      if (!cur || cur.key !== k) { flush(); cur = { key: k, days: [] }; }
      cur.days.push(d);
    }
    flush();
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals, start, end, agg, nutri.targets, today]);

  // Averages over days you logged (not counting days logged ahead)
  const past = buckets.flatMap((b) => b.logged).filter((d) => d.day <= today);
  const avg = avgOf(past);
  const pastTargets = past.map((d) => tgt(d.day)).filter((t): t is NonNullable<ReturnType<typeof tgt>> => !!t);
  const avgTarget = (k: "kcal" | "protein" | "fat" | "carbs") => { const v = pastTargets.map((t) => t[k]).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const spanDays = Math.max(1, daysBetween(start, end < today ? end : today) + 1);

  const only = on.size === 1 && !on.has("o") ? ([...on][0] as "p" | "f" | "c") : null; // one macro: chart it in grams
  const gramKey = only === "p" ? "protein" : only === "f" ? "fat" : only === "c" ? "carbs" : null;
  const toggle = (s: Series) => { setOn((cur) => { const n = new Set(cur); if (n.has(s)) { if (n.size > 1) n.delete(s); } else n.add(s); return n; }); };
  const shift = (dir: -1 | 1) => { if (!range) return; const n = addDays(end, dir * range); setEnd(n > addDays(today, 7) ? addDays(today, 7) : n); setSel(null); };
  const selB = sel != null ? buckets[sel] : null;

  const label = range ? `${fmtDay(start, { day: "numeric", month: "short" })} – ${fmtDay(end, { day: "numeric", month: "short", year: "numeric" })}` : `${fmtDay(start, { month: "short", year: "numeric" })} – now`;

  return (
    <div className="ntr">
      <section className="panel">
        <div className="ntr-head">
          <div className="ntr-avgs">
            {([["Protein", "protein", "p"], ["Fat", "fat", "f"], ["Carbs", "carbs", "c"]] as const).map(([name, k, cls]) => (
              <div key={k}>
                <span className="small muted"><i className={`mk ${cls}`} />{name}</span>
                <span className="ntr-big num">{avg ? Math.round(avg[k]) : "–"}<small> g</small></span>
                {avg && avgTarget(k) != null && <span className={`small ${Math.abs(avg[k] - avgTarget(k)!) <= avgTarget(k)! * 0.05 ? "ok" : "muted"}`}>{diff(avg[k] - avgTarget(k)!)} vs {Math.round(avgTarget(k)!)}</span>}
              </div>
            ))}
            <div>
              <span className="small muted">Calories</span>
              <span className="ntr-big num">{avg ? fmtKcal(avg.kcal) : "–"}</span>
              {avg && avgTarget("kcal") != null && <span className={`small ${Math.abs(avg.kcal - avgTarget("kcal")!) <= avgTarget("kcal")! * 0.05 ? "ok" : "muted"}`}>{diff(avg.kcal - avgTarget("kcal")!)} vs {fmtKcal(avgTarget("kcal")!)}</span>}
            </div>
          </div>
          <div className="ntr-range">
            {range ? <button className="icon-btn" aria-label="Earlier" onClick={() => shift(-1)}>‹</button> : null}
            <span className="small">{label}<span className="muted"> · daily average of {past.length} logged day{past.length === 1 ? "" : "s"}{past.length < spanDays ? ` (of ${spanDays})` : ""}</span></span>
            {range ? <button className="icon-btn" aria-label="Later" disabled={end >= addDays(today, 7)} onClick={() => shift(1)}>›</button> : null}
          </div>
        </div>

        <MacroChart buckets={buckets} on={on} gramKey={gramKey} agg={agg} today={today} sel={sel} onSel={setSel} />

        <div className="ntr-controls">
          <div className="seg ntr-ranges" role="group" aria-label="Range">
            {RANGES.map(({ r, label: l }) => <button key={l} className={range === r ? "on" : ""} aria-pressed={range === r} onClick={() => { setRange(r); setEnd(today); setSel(null); setAggPick(null); }}>{l}</button>)}
          </div>
          <select className="input ntr-agg" value={agg} onChange={(e) => { setAggPick(e.target.value as Agg); setSel(null); }} aria-label="Group by">
            <option value="D">Days</option>
            <option value="W">Weeks</option>
            <option value="M">Months</option>
          </select>
        </div>
        <div className="ntr-legend" role="group" aria-label="Show">
          {SERIES.map(({ s, label: l }) => (
            <button key={s} className={`ntr-leg${on.has(s) ? " on" : ""}`} aria-pressed={on.has(s)} onClick={() => { toggle(s); setSel(null); }}><i className={`mk ${s === "o" ? "o" : s}`} />{l}</button>
          ))}
        </div>
        {gramKey && <p className="muted small" style={{ marginTop: 6 }}>Showing {gramKey} in grams. Tap more macros to go back to calories.</p>}

        {selB && (
          <div className="ntr-sel">
            <strong>{agg === "D" ? fmtDay(selB.start, { weekday: "short", day: "numeric", month: "short" }) : agg === "W" ? `Week of ${fmtDay(selB.start, { day: "numeric", month: "short" })}` : fmtDay(selB.start, { month: "long", year: "numeric" })}</strong>
            {selB.avg ? (
              <span className="small">{agg !== "D" && "Daily average: "}{fmtKcal(selB.avg.kcal)} kcal · {fmtG(selB.avg.protein)}P {fmtG(selB.avg.fat)}F {fmtG(selB.avg.carbs)}C{selB.target ? ` · target ${fmtKcal(selB.target.kcal)}` : ""}{selB.planned ? " · planned" : ""}</span>
            ) : <span className="small muted">Nothing logged</span>}
            {agg === "D" && <button className="link small" onClick={() => onOpenDay(selB.start)}>Open day ›</button>}
          </div>
        )}
      </section>

      <div className="cols" style={{ marginTop: 14 }}>
        <div className="col">
          <WeekBudget nutri={nutri} totals={totals} today={today} />
          <Habits nutri={nutri} totals={totals} today={today} />
        </div>
        <div className="col">
          <DayList buckets={buckets} totals={totals} start={start} end={end} today={today} tgt={tgt} onOpenDay={onOpenDay} />
        </div>
      </div>
    </div>
  );
}

function daysBetween(a: string, b: string) { return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000); }
const diff = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtKcal(Math.abs(v))}`;

function MacroChart({ buckets, on, gramKey, agg, today, sel, onSel }: { buckets: Bucket[]; on: Set<Series>; gramKey: "protein" | "fat" | "carbs" | null; agg: Agg; today: string; sel: number | null; onSel: (i: number | null) => void }) {
  const wide = useDesktop();
  const W = wide ? 900 : 340, H = wide ? 260 : 190, padL = 8, padR = 36, padT = 8, padB = 22;
  const n = buckets.length;
  const segs = (b: Bucket) => {
    const a = b.avg;
    if (!a) return [] as { s: Series; v: number }[];
    if (gramKey) return [{ s: gramKey[0] as Series, v: a[gramKey] }];
    return ([["p", a.protein * 4], ["f", a.fat * 9], ["c", a.carbs * 4], ["o", kcalOther(a)]] as [Series, number][]).filter(([s]) => on.has(s)).map(([s, v]) => ({ s, v }));
  };
  const tval = (b: Bucket) => (!b.target ? null : gramKey ? b.target[gramKey] : b.target.kcal);
  const maxV = Math.max(1, ...buckets.map((b) => segs(b).reduce((a, x) => a + x.v, 0)), ...buckets.map((b) => tval(b) ?? 0));
  const step = gramKey ? niceStep(maxV / 3) : niceStep(maxV / 3);
  const top = Math.ceil((maxV * 1.05) / step) * step;
  const slot = (W - padL - padR) / Math.max(1, n);
  const bw = Math.max(1.5, Math.min(26, slot * (n > 60 ? 0.85 : 0.68)));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const x = (i: number) => padL + slot * i + slot / 2;
  const ticks = [0, step, step * 2, step * 3].filter((t) => t <= top);
  const lbl = (b: Bucket, i: number) => {
    if (agg === "M") return fromYmd(b.start).toLocaleDateString("en-IE", { month: "short" });
    if (n <= 7) return fromYmd(b.start).toLocaleDateString("en-IE", { weekday: "short" });
    const every = Math.ceil(n / (wide ? 10 : 5));
    return (n - 1 - i) % every === 0 ? fromYmd(b.start).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "";
  };
  return (
    <svg className="chart ntr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={gramKey ? `${gramKey} by ${agg === "D" ? "day" : agg === "W" ? "week" : "month"}` : "Calories from protein, fat and carbs"}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="axis" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} opacity={t === 0 ? 1 : 0.5} strokeDasharray={t === 0 ? undefined : "3 3"} />
          <text x={W - padR + 4} y={y(t) + 4}>{gramKey ? t : t >= 1000 ? `${t / 1000}k` : t}</text>
        </g>
      ))}
      {buckets.map((b, i) => {
        let acc = 0;
        const ss = segs(b);
        const t = tval(b);
        const future = b.start > today;
        return (
          <g key={b.key} onClick={() => onSel(sel === i ? null : i)} style={{ cursor: "pointer" }} opacity={sel != null && sel !== i ? 0.45 : future ? 0.5 : 1}>
            <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
            {ss.map((sg) => {
              const y1 = y(acc + sg.v), y0 = y(acc);
              acc += sg.v;
              return <rect key={sg.s} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} className={`seg-${sg.s}`} />;
            })}
            {t != null && <line x1={x(i) - slot / 2} x2={x(i) + slot / 2} y1={y(t)} y2={y(t)} className="ntr-target" />}
            <text x={x(i)} y={H - 6} textAnchor="middle">{lbl(b, i)}</text>
            <title>{b.avg ? `${b.start}: ${Math.round(gramKey ? b.avg[gramKey] : b.avg.kcal)}${gramKey ? " g" : " kcal"}` : `${b.start}: nothing logged`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function niceStep(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** This week (Mon–Sun): what's left to average your targets. Logging tomorrow's food ahead counts as planned. */
function WeekBudget({ nutri, totals, today }: { nutri: NutritionData; totals: Map<string, DayTotal>; today: string }) {
  const mon = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const ts = days.map((d) => targetFor(nutri.targets, d));
  if (ts.some((t) => !t)) return null;
  const budget = ts.reduce((a, t) => a + t!.kcal, 0);
  const pBudget = ts.every((t) => t!.protein != null) ? ts.reduce((a, t) => a + t!.protein!, 0) : null;
  const done = days.filter((d) => d < today).map((d) => totals.get(d)).filter((x): x is DayTotal => !!x);
  const eaten = done.reduce((a, d) => a + d.kcal, 0);
  const pEaten = done.reduce((a, d) => a + d.protein, 0);
  const left = days.filter((d) => d >= today).length;
  const perDay = (budget - eaten) / left;
  const pPerDay = pBudget != null ? (pBudget - pEaten) / left : null;
  const t0 = ts[days.indexOf(today)]!;
  const unlogged = days.filter((d) => d < today && !totals.get(d)).length;
  return (
    <section className="panel">
      <h2 style={{ marginBottom: 6 }}>This week</h2>
      <div className="ntr-budget">
        <div><span className="small muted">Weekly target</span><span className="num ntr-mid">{fmtKcal(budget)}</span></div>
        <div><span className="small muted">Eaten Mon–yesterday</span><span className="num ntr-mid">{fmtKcal(eaten)}</span></div>
        <div><span className="small muted">{left === 1 ? "Left for today" : `Per day, today to Sunday (${left})`}</span><span className={`num ntr-mid${perDay < t0.kcal * 0.85 ? " warn" : ""}`}>{fmtKcal(perDay)}</span></div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {perDay >= t0.kcal * 0.97 && perDay <= t0.kcal * 1.03 ? "On track: keep to your daily target." : perDay > t0.kcal ? `You've room for about ${fmtKcal(perDay - t0.kcal)} kcal a day more than target and still average it this week.` : `To average your target, aim about ${fmtKcal(t0.kcal - perDay)} kcal a day under it for the rest of the week (or just let it go: one week's average isn't make or break).`}
        {pPerDay != null && ` Protein: ${Math.round(pPerDay)} g a day.`}
        {unlogged > 0 && ` ${unlogged} earlier day${unlogged === 1 ? " has" : "s have"} nothing logged, so ${unlogged === 1 ? "it counts" : "they count"} as zero here.`}
      </p>
    </section>
  );
}

function Habits({ nutri, totals, today }: { nutri: NutritionData; totals: Map<string, DayTotal>; today: string }) {
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const weighed = new Set(nutri.weights.map((w) => w.measured_on));
  const mon = mondayOf(today);
  const week = days.filter((d) => d >= mon);
  const row = (name: string, has: (d: string) => boolean, cls: string) => (
    <div className="habit">
      <div className="habit-head"><strong>{name}</strong><span className="small muted">{week.filter(has).length}/{week.length} this week · {days.filter(has).length}/30</span></div>
      <div className="habit-grid">{days.map((d) => <i key={d} className={has(d) ? cls : ""} title={`${d}${has(d) ? "" : ": none"}`} />)}</div>
    </div>
  );
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 6 }}>Habits <span className="small muted">last 30 days</span></h2>
      {row("Food logging", (d) => (totals.get(d)?.entries ?? 0) > 0, "on-food")}
      {row("Weigh-ins", (d) => weighed.has(d), "on-weigh")}
    </section>
  );
}

function DayList({ totals, start, end, today, tgt, onOpenDay }: { buckets: Bucket[]; totals: Map<string, DayTotal>; start: string; end: string; today: string; tgt: (d: string) => ReturnType<typeof targetFor>; onOpenDay: (d: string) => void }) {
  const days: DayTotal[] = [];
  for (let d = end; d >= start; d = addDays(d, -1)) { const t = totals.get(d); if (t && t.entries > 0) days.push(t); if (days.length >= 120) break; }
  if (!days.length) return <div className="empty"><p>Nothing logged in this period.</p></div>;
  let month = "";
  return (
    <section>
      {days.map((d) => {
        const m = fmtDay(d.day, { month: "long", year: "numeric" });
        const head = m !== month ? (month = m) : null;
        const t = tgt(d.day);
        const mk = d.protein * 4 + d.fat * 9 + d.carbs * 4 || 1;
        return (
          <div key={d.day}>
            {head && <h3 className="group-h">{head}</h3>}
            <button className="panel ntr-day" onClick={() => onOpenDay(d.day)}>
              <span className="ntr-day-top">
                <strong>{fmtDay(d.day, { weekday: "short", day: "numeric", month: "short" })}{d.day > today && <span className="chip" style={{ marginLeft: 6 }}>planned</span>}</strong>
                <span className="num"><strong>{fmtKcal(d.kcal)}</strong> kcal{t && <span className={`small ${Math.abs(d.kcal - t.kcal) <= t.kcal * 0.05 ? "ok" : "muted"}`}> {diff(d.kcal - t.kcal)}</span>}</span>
              </span>
              <span className="macro-sub">
                <span className="num">{fmtG(d.protein)}<b className="p">P</b> {fmtG(d.fat)}<b className="f">F</b> {fmtG(d.carbs)}<b className="c">C</b></span>
                <span>· {Math.round((d.protein * 4 / mk) * 100)}% P · {Math.round((d.fat * 9 / mk) * 100)}% F · {Math.round((d.carbs * 4 / mk) * 100)}% C</span>
              </span>
              {t && t.protein != null && (
                <span className="ntr-mini">
                  {([["p", d.protein, t.protein], ["f", d.fat, t.fat], ["c", d.carbs, t.carbs]] as const).map(([c, v, tv]) => tv != null && (
                    <span key={c} className="tbar-track"><span className={`tbar-fill ${c}${v > tv * 1.05 ? " over" : ""}`} style={{ width: `${Math.min(100, (v / tv) * 100)}%` }} /></span>
                  ))}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </section>
  );
}
