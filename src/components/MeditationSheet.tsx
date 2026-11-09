import { useEffect, useState } from "react";
import { DateSheet } from "./food/Pickers";
import { fromYmd, todayYmd } from "../lib/nutrition";
import { addMeditation, deleteMeditation, useMeditation } from "../lib/meditation";

const PRESETS = [5, 10, 15, 20, 30];

/** Quick meditation log from the shortcuts: pick the minutes, Save. Shows what's already logged that day. */
export default function MeditationSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (text: string) => void }) {
  const sessions = useMeditation();
  const [day, setDay] = useState(todayYmd());
  const [mins, setMins] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDay(todayYmd());
    setError(null);
    setBusy(false);
    // Start from the length you usually do
    const last = sessions?.[0]?.minutes;
    setMins(String(last ?? 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const m = parseInt(mins, 10);
  const ok = Number.isInteger(m) && m >= 1 && m <= 600;
  const onDay = (sessions ?? []).filter((s) => s.day === day);
  const total = onDay.reduce((a, s) => a + s.minutes, 0);
  const label = day === todayYmd() ? "Today" : fromYmd(day).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  async function save() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMeditation(day, m);
      onClose();
      onSaved?.(`Meditation logged: ${m} min`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try { await deleteMeditation(id); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete."); }
    setBusy(false);
  }

  return (
    <>
      <div className={`sheet-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <form className={`sheet weigh-sheet med-sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Log meditation" aria-hidden={!open}
        onSubmit={(e) => { e.preventDefault(); save(); }}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="icon-btn sheet-x" aria-label="Close" onClick={onClose} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <button type="button" className="weigh-date" onClick={() => setDateOpen(true)} tabIndex={open ? 0 : -1} aria-label={`Date: ${label}. Change`}>
            <span className="weigh-date-main">{label} <span aria-hidden="true">▾</span></span>
            <span className="small muted">Meditation</span>
          </button>
          <span style={{ width: 40 }} />
        </div>
        <div className="med-body">
          <div className="med-chips" role="group" aria-label="Minutes">
            {PRESETS.map((p) => (
              <button key={p} type="button" className={`fchip${m === p ? " on" : ""}`} aria-pressed={m === p} onClick={() => setMins(String(p))} tabIndex={open ? 0 : -1}>{p} min</button>
            ))}
          </div>
          <label className="field">
            <span>Minutes</span>
            <span className="weigh-input"><input className="input" inputMode="numeric" enterKeyHint="done" value={mins} onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Minutes" tabIndex={open ? 0 : -1} onFocus={(e) => e.currentTarget.select()} /><span className="weigh-unit">min</span></span>
          </label>
          {onDay.length > 0 && (
            <div className="med-logged">
              <span className="small muted">Logged {label === "Today" ? "today" : "this day"}: {total} min</span>
              {onDay.map((s) => (
                <span key={s.id} className="med-pill">
                  {s.minutes} min
                  <button type="button" className="icon-btn" aria-label={`Remove ${s.minutes} minute session`} disabled={busy} onClick={() => remove(s.id)} tabIndex={open ? 0 : -1}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          <button className="btn primary block" disabled={!ok || busy} tabIndex={open ? 0 : -1}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <DateSheet open={dateOpen} value={day} max={todayYmd()} onPick={setDay} onClose={() => setDateOpen(false)} title="Meditation date" />
    </>
  );
}
