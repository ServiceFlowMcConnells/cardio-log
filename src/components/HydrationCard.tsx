import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/types";
import type { WaterEntry } from "../lib/hydration";
import { WATER_AMOUNTS, addWater, deleteWater, litres, localDate, totalOn, useWater } from "../lib/hydration";
import { writeWaterToHealth } from "../lib/health";
import { inAndroidApp } from "../lib/nativeTimer";

/** Dashboard: today's water against the target, a big + for the usual amount, other amounts, undo and today's list. */
export default function HydrationCard({ settings, onHistory }: { settings: Settings; onHistory?: () => void }) {
  const entries = useWater();
  const today = localDate();
  const total = entries ? totalOn(entries, today) : 0;
  const target = settings.water_target_ml || 3000;
  const inc = settings.water_increment_ml || 250;
  const pct = Math.min(1, total / target);
  const hit = total >= target;
  const [custom, setCustom] = useState<string | null>(null);
  const [undo, setUndo] = useState<WaterEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const add = async (ml: number) => {
    if (!(ml > 0 && ml <= 5000)) return;
    setError(null);
    const e = await addWater(ml, inAndroidApp() ? "app" : "web");
    void writeWaterToHealth(e.ml, e.logged_at);
    setUndo(e);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndo(null), 10000);
  };
  const remove = async (id: string) => {
    setError(null);
    try { await deleteWater(id); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete that."); }
  };
  const doUndo = async () => {
    if (!undo) return;
    window.clearTimeout(timer.current);
    const id = undo.client_id;
    setUndo(null);
    await remove(id);
  };
  const todays = (entries ?? []).filter((e) => e.local_date === today);
  const cm = custom != null ? parseInt(custom, 10) : NaN;

  const R = 19, C = 2 * Math.PI * R;
  return (
    <section className={`hyd-strip${hit ? " hit" : ""}${open ? " open" : ""}`} id="hydration" aria-label="Hydration">
      <div className="ready-strip hyd-row">
        <button type="button" className="hyd-main" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`Water today ${litres(total)} of ${litres(target)} litres. ${open ? "Hide" : "Show"} more`}>
          <span className="steps-ring hyd-ring" aria-hidden="true">
            <svg viewBox="0 0 46 46" width="46" height="46">
              <circle cx="23" cy="23" r={R} className="steps-ring-bg" />
              <circle cx="23" cy="23" r={R} className="steps-ring-fill" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 23 23)" />
            </svg>
            <span>{Math.round((total / target) * 100)}%</span>
          </span>
          <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
            <span className="hyd-line"><strong>{litres(total)} / {litres(target)} L</strong> <span className="small">{hit ? "target hit" : `${litres(target - total)} L to go`}</span></span>
            <span className="fs2-track" style={{ marginTop: 6 }}><span className="fs2-fill hyd-fill" style={{ width: `${pct * 100}%` }} /></span>
          </span>
        </button>
        <button type="button" className="hyd-plus" onClick={() => add(inc)} aria-label={`Add ${inc} ml`}>+{inc}<small> ml</small></button>
      </div>
      {undo && !open && (
        <div className="hyd-undo" role="status">
          <span>Added {undo.ml} ml</span>
          <button className="link" onClick={doUndo}>Undo</button>
        </div>
      )}
      {open && (
        <div className="hyd-more">
          {undo && (
            <div className="hyd-undo" role="status" style={{ margin: 0, background: "var(--ground)" }}>
              <span>Added {undo.ml} ml</span>
              <button className="link" onClick={doUndo}>Undo</button>
            </div>
          )}
          <div className="hyd-chips" role="group" aria-label="Other amounts">
            {WATER_AMOUNTS.map((a) => <button key={a} type="button" className="fchip" onClick={() => add(a)}>{a} ml</button>)}
            <button type="button" className={`fchip${custom != null ? " on" : ""}`} aria-expanded={custom != null} onClick={() => setCustom(custom == null ? "" : null)}>Custom</button>
          </div>
          {custom != null && (
            <form className="hyd-custom" onSubmit={(e) => { e.preventDefault(); if (cm > 0) { void add(cm); setCustom(null); } }}>
              <span className="weigh-input"><input className="input" inputMode="numeric" autoFocus placeholder="Amount" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Custom amount in ml" /><span className="weigh-unit">ml</span></span>
              <button className="btn" disabled={!(cm > 0 && cm <= 5000)}>Add</button>
            </form>
          )}
          {todays.length > 0 && (
            <ul className="hyd-list" aria-label="Today's drinks">
              {todays.map((e) => (
                <li key={e.client_id}>
                  <span className="num">{new Date(e.logged_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{e.ml} ml{e.source === "widget" ? <small className="muted"> · widget</small> : null}{e.pending ? <small className="muted"> · saving…</small> : null}</span>
                  <button className="icon-btn" aria-label={`Delete ${e.ml} ml`} onClick={() => remove(e.client_id)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onHistory && <button className="link small" style={{ justifySelf: "start" }} onClick={onHistory}>History ›</button>}
        </div>
      )}
      {error && <p className="error small" style={{ margin: "4px 0 0" }}>{error}</p>}
    </section>
  );
}
