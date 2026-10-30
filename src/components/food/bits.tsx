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

// ---------- macros-first entry ----------
export type MacroForm = { protein: string; carbs: string; fat: string; kcal: string; manual: boolean };

export const macroForm = (m?: { protein: number | null; carbs: number | null; fat: number | null; kcal: number | null } | null): MacroForm => {
  const s = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 10) / 10));
  const fromMacros = m && m.protein != null && m.carbs != null && m.fat != null ? m.protein * 4 + m.carbs * 4 + m.fat * 9 : null;
  // Calories typed in by hand if they don't match the macros (e.g. alcohol, or a calories-only entry)
  const manual = m?.kcal != null && (fromMacros == null || (fromMacros === 0 && m.kcal > 0) || Math.abs(fromMacros - m.kcal) > Math.max(5, m.kcal * 0.02));
  return { protein: s(m?.protein), carbs: s(m?.carbs), fat: s(m?.fat), kcal: manual ? s(m?.kcal) : "", manual };
};

/** Calories: 4 per gram of protein and carbs, 9 per gram of fat, unless typed in by hand. */
export function formKcal(v: MacroForm): number | null {
  if (v.manual) return num(v.kcal);
  const p = num(v.protein), c = num(v.carbs), f = num(v.fat);
  if (p == null && c == null && f == null) return null;
  return (p ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9;
}

export function MacroInputs({ v, set, autoFocus, kcalLabel = "Calories" }: { v: MacroForm; set: (v: MacroForm) => void; autoFocus?: boolean; kcalLabel?: string }) {
  const k = formKcal(v);
  return (
    <div className="macro-inputs">
      <div className="grid c3">
        {(["protein", "carbs", "fat"] as const).map((key, i) => (
          <label className="field" key={key}>
            <span><i className={`mk ${key[0]}`} />{key[0].toUpperCase() + key.slice(1)} (g)</span>
            <input className="input" inputMode="decimal" value={v[key]} autoFocus={autoFocus && i === 0} onChange={(e) => set({ ...v, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      {v.manual ? (
        <label className="field" style={{ marginTop: 10 }}>
          <span>{kcalLabel} (kcal)</span>
          <input className="input" inputMode="decimal" value={v.kcal} onChange={(e) => set({ ...v, kcal: e.target.value })} />
        </label>
      ) : (
        <div className="kcal-auto">
          <span className="muted small">{kcalLabel}</span>
          <span><strong className="num">{k != null ? fmtKcal(k) : "–"}</strong> <span className="muted">kcal</span></span>
        </div>
      )}
      <button type="button" className="link small" style={{ marginTop: 6 }} onClick={() => set({ ...v, manual: !v.manual, kcal: v.manual ? "" : k != null ? String(Math.round(k)) : "" })}>
        {v.manual ? "Work calories out from the macros" : "Enter calories yourself"}
      </button>
    </div>
  );
}
