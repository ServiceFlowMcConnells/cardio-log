import type { Macros } from "../../lib/nutrition";

export const fmtG = (g: number) => (g >= 100 ? String(Math.round(g)) : String(Math.round(g * 10) / 10));
export const fmtKcal = (k: number) => Math.round(k).toLocaleString("en-IE");

/** "320 kcal · P 24 · C 30 · F 9" */
export function MacroLine({ m, big }: { m: Macros; big?: boolean }) {
  return (
    <span className={`macro-line${big ? " big" : ""}`}>
      <strong>{fmtKcal(m.kcal)} kcal</strong>
      <span><i className="mk p" />P {fmtG(m.protein)}</span>
      <span><i className="mk c" />C {fmtG(m.carbs)}</span>
      <span><i className="mk f" />F {fmtG(m.fat)}</span>
    </span>
  );
}

/** One target bar: eaten vs target, turning to the "over" colour past it. */
export function TargetBar({ label, eaten, target, unit, cls }: { label: string; eaten: number; target: number | null; unit: string; cls: string }) {
  const pct = target ? Math.min(100, (eaten / target) * 100) : 0;
  const over = target != null && eaten > target * 1.05;
  return (
    <div className="tbar">
      <div className="tbar-top">
        <span className="small"><i className={`mk ${cls}`} />{label}</span>
        <span className="small num">
          <strong>{unit === "kcal" ? fmtKcal(eaten) : Math.round(eaten)}</strong>
          {target != null ? <span className="muted"> / {unit === "kcal" ? fmtKcal(target) : target} {unit}</span> : <span className="muted"> {unit}</span>}
        </span>
      </div>
      {target != null && (
        <div className="tbar-track"><div className={`tbar-fill ${cls}${over ? " over" : ""}`} style={{ width: `${pct}%` }} /></div>
      )}
    </div>
  );
}

export function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export const num = (s: string): number | null => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};
