import { useEffect, useRef, useState } from "react";
import { RANGE_PRESETS, rangeLabel, useDeskRange } from "../../lib/deskRange";
import { todayYmd } from "../../lib/nutrition";

export interface Crumb { label: string; onClick?: () => void }

/** Desktop top bar: where you are, the shared date range, and quick logging. */
export default function TopBar({ crumbs, showRange, onLogFood, onLogCardio, tabs }: {
  crumbs: Crumb[]; showRange: boolean; onLogFood: () => void; onLogCardio: () => void;
  tabs?: { items: { id: string; label: string }[]; active: string; onPick: (id: string) => void };
}) {
  const ctx = useDeskRange();
  const [custom, setCustom] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(ctx?.range.from ?? "");
  const [to, setTo] = useState(ctx?.range.to ?? todayYmd());
  useEffect(() => {
    if (!custom) return;
    const off = (e: MouseEvent) => { if (pop.current && !pop.current.contains(e.target as Node)) setCustom(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCustom(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [custom]);
  const r = ctx?.range;
  // Sticky panes sit just under the bar, which can wrap to two rows on narrower laptops
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--tb-h", `${Math.round(el.getBoundingClientRect().height) + 24}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="topbar" ref={bar}>
      <div className="tb-left">
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
              {c.onClick && i < crumbs.length - 1
                ? <button className="crumb-link" onClick={c.onClick}>{c.label}</button>
                : <span className={i === crumbs.length - 1 ? "crumb-here" : undefined} aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>
        {tabs && (
          <div className="tb-tabs" role="tablist">
            {tabs.items.map((t) => (
              <button key={t.id} role="tab" aria-selected={tabs.active === t.id} className={`tb-tab${tabs.active === t.id ? " on" : ""}`} onClick={() => tabs.onPick(t.id)}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="tb-right">
        {showRange && ctx && r && (
          <div className="tb-range" ref={pop}>
            <div className="seg-range" role="group" aria-label={`Date range: ${rangeLabel(r)}`}>
              {RANGE_PRESETS.map((p) => (
                <button key={p.id} className={r.preset === p.id ? "on" : ""} aria-pressed={r.preset === p.id} onClick={() => ctx.setRange({ preset: p.id })}>{p.label}</button>
              ))}
              <button className={r.preset === "custom" ? "on" : ""} aria-pressed={r.preset === "custom"} aria-expanded={custom} onClick={() => setCustom((o) => !o)}>
                {r.preset === "custom" ? rangeLabel(r) : "Custom"}
              </button>
            </div>
            {custom && (
              <div className="tb-custom panel" role="dialog" aria-label="Custom range">
                <label className="field"><span>From</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="field"><span>To</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
                <button className="btn primary" disabled={!from || !to || from > to} onClick={() => { ctx.setRange({ preset: "custom", from, to }); setCustom(false); }}>Apply</button>
              </div>
            )}
          </div>
        )}
        <button className="btn ghost tb-btn" onClick={onLogCardio}>+ Cardio</button>
        <button className="btn primary tb-btn" onClick={onLogFood}>+ Food</button>
      </div>
    </header>
  );
}
