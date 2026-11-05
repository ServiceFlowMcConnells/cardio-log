import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addDays, fromYmd, todayYmd, ymd } from "../../lib/nutrition";
import { dayIndex } from "../../lib/dates";

// MacroFactor-style pickers for the food side: a bottom sheet of 1-hour blocks (07:00–23:00, like the log) and a
// month grid for dates. Rendered into <body> so they sit above other sheets (the log sheet, the weigh-in).

const hh = (n: number) => String(n).padStart(2, "0");
export const FIRST_HOUR = 7;
export const LAST_HOUR = 23;

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return createPortal(
    <>
      <div className={`sheet-backdrop picker-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div className={`sheet picker-sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="icon-btn sheet-x" aria-label="Close" onClick={onClose} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <strong>{title}</strong>
          <span style={{ width: 40 }} />
        </div>
        <div className="picker-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/** The hour grid. Hours earlier than 07:00 appear only if the value is one (an early entry). */
export function TimeSheet({ open, value, onPick, onClose, title = "Select time", showNow = true }: { open: boolean; value: string; onPick: (t: string) => void; onClose: () => void; title?: string; showNow?: boolean }) {
  const cur = Number(value.slice(0, 2));
  const start = Math.min(FIRST_HOUR, Number.isFinite(cur) ? cur : FIRST_HOUR);
  const now = new Date().getHours();
  const hours = Array.from({ length: LAST_HOUR - start + 1 }, (_, i) => start + i);
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="hour-grid">
        {hours.map((h) => (
          <button key={h} type="button" className={`hour-cell${h === cur ? " on" : ""}${showNow && h === now ? " now" : ""}`} aria-pressed={h === cur} tabIndex={open ? 0 : -1}
            aria-label={`${hh(h)}:00${showNow && h === now ? " (now)" : ""}`} onClick={() => { onPick(`${hh(h)}:00`); onClose(); }}>
            <span className="hour-cell-h">{h}</span><span className="hour-cell-m">:00</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** A month grid. `max`/`min` limit the days you can pick. */
export function DateSheet({ open, value, onPick, onClose, title = "Select date", min, max }: { open: boolean; value: string; onPick: (d: string) => void; onClose: () => void; title?: string; min?: string; max?: string }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  useEffect(() => { if (open) setMonth(value.slice(0, 7)); }, [open, value]);
  const first = fromYmd(`${month}-01`);
  const lead = dayIndex(first);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = todayYmd();
  const shift = (n: number) => { const d = new Date(first.getFullYear(), first.getMonth() + n, 1); setMonth(ymd(d).slice(0, 7)); };
  const prevLast = ymd(new Date(first.getFullYear(), first.getMonth(), 0));
  const nextFirst = ymd(new Date(first.getFullYear(), first.getMonth() + 1, 1));
  const heads = Array.from({ length: 7 }, (_, i) => fromYmd(addDays(ymd(first), i - lead)).toLocaleDateString("en-IE", { weekday: "narrow" }));
  const quick = [{ d: addDays(today, -1), l: "Yesterday" }, { d: today, l: "Today" }, { d: addDays(today, 1), l: "Tomorrow" }].filter((q) => (!min || q.d >= min) && (!max || q.d <= max));
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="date-quick">
        {quick.map((q) => <button key={q.l} type="button" className={`fchip${q.d === value ? " on" : ""}`} tabIndex={open ? 0 : -1} onClick={() => { onPick(q.d); onClose(); }}>{q.l}</button>)}
      </div>
      <div className="date-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" disabled={!!min && prevLast < min} onClick={() => shift(-1)} tabIndex={open ? 0 : -1}>‹</button>
        <strong>{first.toLocaleDateString("en-IE", { month: "long", year: "numeric" })}</strong>
        <button type="button" className="icon-btn" aria-label="Next month" disabled={!!max && nextFirst > max} onClick={() => shift(1)} tabIndex={open ? 0 : -1}>›</button>
      </div>
      <div className="date-grid">
        {heads.map((h, i) => <span key={i} className="date-head">{h}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${month}-${hh(i + 1)}`;
          const off = (!!min && d < min) || (!!max && d > max);
          return (
            <button key={d} type="button" className={`date-cell${d === value ? " on" : ""}${d === today ? " now" : ""}`} disabled={off} tabIndex={open ? 0 : -1}
              aria-pressed={d === value} aria-label={fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })} onClick={() => { onPick(d); onClose(); }}>{i + 1}</button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** A time pill that opens the hour grid (replaces the old ‹ select › hour picker). */
export function HourPicker({ value, onChange, title }: { value: string; onChange: (t: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pick-pill num" onClick={() => setOpen(true)} aria-label={`Time ${value.slice(0, 5)}. Change`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
        {value.slice(0, 5)}
      </button>
      <TimeSheet open={open} value={value} onPick={onChange} onClose={() => setOpen(false)} title={title} />
    </>
  );
}

/** A date pill that opens the month grid (replaces <input type="date"> on the food side). */
export function DateField({ value, onChange, min, max, title, label }: { value: string; onChange: (d: string) => void; min?: string; max?: string; title?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const today = todayYmd();
  const text = value === today ? "Today" : value === addDays(today, -1) ? "Yesterday" : value === addDays(today, 1) ? "Tomorrow" : fromYmd(value).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <button type="button" className="pick-pill" onClick={() => setOpen(true)} aria-label={`${label ?? "Date"}: ${text}. Change`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
        {text}
      </button>
      <DateSheet open={open} value={value} onPick={onChange} onClose={() => setOpen(false)} min={min} max={max} title={title} />
    </>
  );
}
