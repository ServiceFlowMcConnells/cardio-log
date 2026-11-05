import { useEffect, useRef, useState } from "react";
import type { NutritionData } from "../lib/nutrition";
import { deleteBodyFat, deleteWeight, fromYmd, loadNutrition, saveBodyFat, saveWeight, todayYmd } from "../lib/nutrition";

/** Quick weigh-in from the shortcuts (MacroFactor style): date, scale weight and optional body fat, then Save.
 *  Opens over whatever you're on and closes back to it. */
export default function WeighInSheet({ open, onClose, nutri, setNutri, onSaved }: {
  open: boolean;
  onClose: () => void;
  nutri: NutritionData;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onSaved?: (text: string) => void;
}) {
  const [day, setDay] = useState(todayYmd());
  const [kg, setKg] = useState("");
  const [bf, setBf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const w = nutri.weights.find((x) => x.measured_on === day);
  const f = nutri.bodyFats.find((x) => x.measured_on === day);

  // Fresh each time it opens: today, with any weigh-in already logged for the day
  useEffect(() => {
    if (!open) return;
    setDay(todayYmd());
    setError(null);
    setBusy(false);
    const t = window.setTimeout(() => weightRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setKg(w ? String(w.weight_kg) : "");
    setBf(f ? String(f.body_fat_pct) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, w?.weight_kg, f?.body_fat_pct]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const num = (s: string) => { const v = parseFloat(s.replace(",", ".")); return Number.isFinite(v) ? v : null; };
  const k = num(kg), b = bf.trim() ? num(bf) : null;
  const kOk = k != null && k >= 30 && k <= 300;
  const bOk = !bf.trim() || (b != null && b >= 2 && b <= 70);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const text = await fn();
      const fresh = await loadNutrition();
      setNutri(() => fresh);
      onClose();
      onSaved?.(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }
  const save = () => kOk && bOk && run(async () => {
    await saveWeight(day, Math.round(k! * 10) / 10);
    if (b != null) await saveBodyFat(day, Math.round(b * 10) / 10);
    else if (f) await deleteBodyFat(f.id);
    return `Weighed in: ${Math.round(k! * 10) / 10} kg${b != null ? `, ${Math.round(b * 10) / 10}% body fat` : ""}`;
  });
  const remove = () => (w || f) && run(async () => {
    if (w) await deleteWeight(w.id);
    if (f) await deleteBodyFat(f.id);
    return "Weigh-in removed";
  });

  const label = day === todayYmd() ? "Today" : fromYmd(day).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <div className={`sheet-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <form className={`sheet weigh-sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Weigh in" aria-hidden={!open}
        onSubmit={(e) => { e.preventDefault(); save(); }}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="icon-btn sheet-x" aria-label="Close" onClick={onClose} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <label className="weigh-date">
            <span className="weigh-date-main">{label} <span aria-hidden="true">▾</span></span>
            <span className="small muted">Scale weight</span>
            <input ref={dateRef} type="date" value={day} max={todayYmd()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Date" tabIndex={open ? 0 : -1}
              onClick={(e) => { try { (e.currentTarget as HTMLInputElement).showPicker?.(); } catch { /* older browsers open on tap */ } }} />
          </label>
          <button type="button" className="icon-btn" aria-label="Delete this weigh-in" disabled={!(w || f) || busy} onClick={remove} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
          </button>
        </div>
        <div className="weigh-body">
          <label className="field weigh-kg">
            <span>Weight</span>
            <span className="weigh-input"><input ref={weightRef} className="input" inputMode="decimal" enterKeyHint="done" value={kg} onChange={(e) => setKg(e.target.value)} placeholder={nutri.weights.length ? String(nutri.weights[nutri.weights.length - 1].weight_kg) : ""} aria-label="Weight in kg" tabIndex={open ? 0 : -1} onFocus={(e) => e.currentTarget.select()} /><span className="weigh-unit">kg</span></span>
          </label>
          <label className="field weigh-bf">
            <span>Body fat</span>
            <span className="weigh-input"><input className="input" inputMode="decimal" enterKeyHint="done" value={bf} onChange={(e) => setBf(e.target.value)} aria-label="Body fat percent (optional)" tabIndex={open ? 0 : -1} /><span className="weigh-unit">%</span></span>
          </label>
          {error && <p className="error" style={{ gridColumn: "1 / -1", margin: 0 }}>{error}</p>}
          {!kOk && kg.trim() !== "" && <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>Weight should be between 30 and 300 kg.</p>}
          <button className="btn primary block weigh-save" disabled={!kOk || !bOk || busy} tabIndex={open ? 0 : -1}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </>
  );
}
