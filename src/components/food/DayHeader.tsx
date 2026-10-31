import { useMemo, useState } from "react";
import type { Macros, NutritionData, Target } from "../../lib/nutrition";
import { dayTotals, fromYmd, targetFor, todayYmd, ymd } from "../../lib/nutrition";
import { dayIndex, weekdayLabels } from "../../lib/dates";
import { fmtKcal } from "./bits";

export function FireIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
      <path d="M12.6 2.2c.4 3-1 4.7-2.5 6.4C8.7 10.2 7 12 7 15a5 5 0 0 0 10 0c0-1.8-.7-3.3-1.6-4.6-.2 1.2-.8 2.2-1.9 2.7.5-2.9-.5-7.2-.9-10.9zM12 20.5a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.2-2.5 2-3.6.3 1.3 1.7 1.8 2.7 2.6.4.3.5.7.5 1A2.6 2.6 0 0 1 12 20.5z" />
    </svg>
  );
}

type Item = { key: string; cls: string; tag: JSX.Element | string; eaten: number; target: number | null; unit: string };

/** One condensed row, like MacroFactor: calories, P, F, C with what's left and a bar in each one's colour. Tap to
 *  switch between left and eaten. */
export function DaySummary({ total, target, onTargets, onTrends }: { total: Macros; target: Target | null; onTargets: () => void; onTrends: () => void }) {
  const [mode, setMode] = useState<"left" | "eaten">("left");
  const items: Item[] = [
    { key: "kcal", cls: "k", tag: <FireIcon />, eaten: total.kcal, target: target?.kcal ?? null, unit: "kcal" },
    { key: "p", cls: "p", tag: "P", eaten: total.protein, target: target?.protein ?? null, unit: "g" },
    { key: "f", cls: "f", tag: "F", eaten: total.fat, target: target?.fat ?? null, unit: "g" },
    { key: "c", cls: "c", tag: "C", eaten: total.carbs, target: target?.carbs ?? null, unit: "g" },
  ];
  const fmt = (it: Item, v: number) => (it.unit === "kcal" ? fmtKcal(v) : String(Math.round(v)));
  return (
    <section className="panel fs2">
      <button className="fs2-row" onClick={() => setMode((m) => (m === "left" ? "eaten" : "left"))} aria-label={mode === "left" ? "Showing what's left. Tap to show what you've eaten" : "Showing what you've eaten. Tap to show what's left"}>
        {items.map((it) => {
          const left = it.target != null ? it.target - it.eaten : null;
          const over = left != null && left < -Math.max(1, it.target! * 0.02);
          const showLeft = mode === "left" && left != null;
          const frac = it.target ? (showLeft ? Math.max(0, left!) / it.target : Math.min(1, it.eaten / it.target)) : 0;
          return (
            <span key={it.key} className="fs2-item">
              <span className="fs2-val">
                <b className={`fs2-tag ${it.cls}`}>{it.tag}</b>
                <span className="num">{showLeft ? fmt(it, Math.abs(left!)) : fmt(it, it.eaten)}</span>
                <span className={`fs2-unit${over ? " over" : ""}`}>{showLeft ? (over ? "over" : "left") : it.target != null ? "eaten" : it.unit}</span>
              </span>
              {it.target != null && <span className="fs2-track"><span className={`fs2-fill ${it.cls}${over ? " over" : ""}`} style={{ width: `${over ? 100 : frac * 100}%` }} /></span>}
            </span>
          );
        })}
      </button>
      <div className="fs-links">
        <button className="link small" onClick={onTargets}>{target ? `Targets: ${fmtKcal(target.kcal)} kcal` : "Set your targets from your coach"}</button>
        <button className="link small" onClick={onTrends}>Trends and averages ›</button>
      </div>
    </section>
  );
}

/** A month to pick a day from. Each day's ring fills with calories eaten against that day's target. */
export function DayCalendar({ nutri, day, onPick, onClose }: { nutri: NutritionData; day: string; onPick: (d: string) => void; onClose: () => void }) {
  const today = todayYmd();
  const [month, setMonth] = useState(day.slice(0, 7));
  const totals = useMemo(() => dayTotals(nutri), [nutri]);
  const first = fromYmd(`${month}-01`);
  const lead = dayIndex(first);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysIn }, (_, i) => ymd(new Date(first.getFullYear(), first.getMonth(), i + 1)));
  const shift = (n: number) => setMonth(ymd(new Date(first.getFullYear(), first.getMonth() + n, 1)).slice(0, 7));
  return (
    <>
      <button className="cal-backdrop" aria-label="Close calendar" onClick={onClose} />
      <div className="cal-pop panel" role="dialog" aria-label="Pick a day">
        <div className="cal-head">
          <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
          <strong>{first.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}</strong>
          <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>›</button>
        </div>
        <div className="cal-grid">
          {weekdayLabels().map((w) => <span key={w} className="cal-wd">{w.slice(0, 2)}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`pad-${i}`} />)}
          {days.map((d) => {
            const t = totals.get(d);
            const tg = targetFor(nutri.targets, d);
            const kcal = t && t.entries > 0 ? t.kcal : 0;
            const frac = kcal && tg ? kcal / tg.kcal : kcal ? 1 : 0;
            const over = tg != null && kcal > tg.kcal * 1.05;
            const C = 2 * Math.PI * 15;
            return (
              <button key={d} className={`cal-day${d === day ? " on" : ""}${d === today ? " today" : ""}${d > today ? " future" : ""}`} onClick={() => onPick(d)} aria-label={`${fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}${kcal ? `, ${fmtKcal(kcal)} kcal` : ""}`} aria-current={d === day ? "date" : undefined}>
                <svg viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15" className="cal-track" />
                  {frac > 0 && <circle cx="18" cy="18" r="15" className={`cal-arc${over ? " over" : ""}`} strokeDasharray={`${Math.min(1, frac) * C} ${C}`} transform="rotate(-90 18 18)" />}
                </svg>
                <span className="cal-num num">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
        <div className="cal-foot">
          <button className="link small" onClick={() => onPick(today)}>Go to today</button>
          <span className="small muted">Rings: calories vs target</span>
        </div>
      </div>
    </>
  );
}
