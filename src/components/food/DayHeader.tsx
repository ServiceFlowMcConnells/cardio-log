import { useMemo, useState } from "react";
import type { Macros, NutritionData, Target } from "../../lib/nutrition";
import { dayTotals, fromYmd, targetFor, todayYmd, ymd } from "../../lib/nutrition";
import { dayIndex, weekdayLabels } from "../../lib/dates";
import { FireIcon, fmtKcal } from "./bits";
import Chevrons from "../Chevrons";

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
                {showLeft ? <span className={`fs2-unit${over ? " over" : ""}`}>{over ? "over" : "left"}</span> : it.target != null ? <span className={`fs2-of${over ? " over" : ""}`}>/{fmt(it, it.target)}</span> : <span className="fs2-unit">{it.unit}</span>}
              </span>
              {it.target != null && <span className="fs2-track"><span className={`fs2-fill ${it.cls}${over ? " over" : ""}`} style={{ width: `${over ? 100 : frac * 100}%` }} /></span>}
            </span>
          );
        })}
      </button>
      <div className="fs-links">
        <button className="link small" onClick={onTargets}>{target ? `${target.day_only ? `${target.note || "One-off"} day` : "Targets"}: ${fmtKcal(target.kcal)} kcal` : "Set your targets from your coach"}</button>
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

/** The Food day's hero: protein, fat and carbs left (tap to switch to eaten), calories as one line underneath. */
export function MacroHero({ total, target, dayLabel, onTargets, onTrends, heroRef }: { total: Macros; target: Target | null; dayLabel: string; onTargets: () => void; onTrends: () => void; heroRef?: (el: HTMLElement | null) => void }) {
  const [mode, setMode] = useState<"left" | "eaten">("left");
  const cols = [
    { k: "Protein", cls: "p", eaten: total.protein, target: target?.protein ?? null },
    { k: "Fat", cls: "f", eaten: total.fat, target: target?.fat ?? null },
    { k: "Carbs", cls: "c", eaten: total.carbs, target: target?.carbs ?? null },
  ];
  const kLeft = target ? target.kcal - total.kcal : null;
  return (
    <section className="hero-card food-hero" ref={heroRef}>
      <Chevrons />
      <button className="fh-tap" onClick={() => setMode((m) => (m === "left" ? "eaten" : "left"))} aria-label={mode === "left" ? "Showing what's left. Tap to show what you've eaten" : "Showing what you've eaten. Tap to show what's left"}>
        <span className="hero-kicker">{dayLabel} · macros {mode === "left" ? "left" : "eaten"}</span>
        <span className="fh-macs">
          {cols.map((c) => {
            const left = c.target != null ? c.target - c.eaten : null;
            const over = left != null && left < -Math.max(1, c.target! * 0.02);
            const showLeft = mode === "left" && left != null;
            const v = showLeft ? Math.abs(left!) : c.eaten;
            const frac = c.target ? Math.min(1, c.eaten / c.target) : 0;
            return (
              <span key={c.k} className="fh-mac">
                <span className={`fh-v num ${c.cls}${over ? " over" : ""}`}>{Math.round(v)}<small>g</small></span>
                <span className="fh-k">{c.k} {showLeft ? (over ? "over" : "left") : "eaten"}</span>
                <span className="fs2-track"><span className={`fs2-fill ${c.cls}${over ? " over" : ""}`} style={{ width: `${over ? 100 : frac * 100}%` }} /></span>
                <span className="small muted">{c.target != null ? `${Math.round(c.eaten)} of ${Math.round(c.target)} g` : "no target"}</span>
              </span>
            );
          })}
        </span>
        <span className="fh-kcal small">
          {kLeft != null
            ? <><b className="num">{fmtKcal(Math.abs(kLeft))} kcal</b> {kLeft >= 0 ? "left" : "over"} · {fmtKcal(total.kcal)} of {fmtKcal(target!.kcal)}</>
            : <><b className="num">{fmtKcal(total.kcal)} kcal</b> eaten</>}
        </span>
      </button>
      <div className="fs-links fh-links">
        <button className="link small" onClick={onTargets}>{target ? `${target.day_only ? `${target.note || "One-off"} day` : "Targets"}: ${fmtKcal(target.kcal)} kcal` : "Set your targets from your coach"}</button>
        <button className="link small" onClick={onTrends}>Trends and averages ›</button>
      </div>
    </section>
  );
}

/** Pinned while the hero is scrolled away: macros left first, calories small. */
export function MacroBar({ total, target, onTop }: { total: Macros; target: Target | null; onTop: () => void }) {
  const chip = (cls: string, tag: string, eaten: number, t: number | null) => {
    const left = t != null ? Math.round(t - eaten) : null;
    return <span className={`fh-chip ${cls}`}>{tag} {left != null ? `${Math.abs(left)} g${left < 0 ? " over" : ""}` : `${Math.round(eaten)} g`}</span>;
  };
  const kLeft = target ? target.kcal - total.kcal : null;
  return (
    <button className="fh-bar" onClick={onTop} aria-label="Back to the top">
      {chip("p", "P", total.protein, target?.protein ?? null)}
      {chip("f", "F", total.fat, target?.fat ?? null)}
      {chip("c", "C", total.carbs, target?.carbs ?? null)}
      <span className="small muted fh-bar-k">{kLeft != null ? `${fmtKcal(Math.abs(kLeft))} kcal ${kLeft >= 0 ? "left" : "over"}` : `${fmtKcal(total.kcal)} kcal`}</span>
    </button>
  );
}
