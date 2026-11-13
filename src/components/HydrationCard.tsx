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
  const [showList, setShowList] = useState(false);
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

  return (
    <section className={`panel hyd-card${hit ? " hit" : ""}`} id="hydration" aria-label="Hydration">
      <div className="hyd-head">
        <h2>Hydration</h2>
        {onHistory && <button className="link small" onClick={onHistory}>History ›</button>}
      </div>
      <div className="hyd-figure">
        <span><strong className="num">{litres(total)}</strong> <span className="muted">/ {litres(target)} L</span></span>
        <span className={`hyd-pct num${hit ? " ok" : ""}`}>{Math.round((total / target) * 100)}%</span>
      </div>
      <span className="hyd-track" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={total} aria-label="Water today">
        <span className="hyd-fill" style={{ width: `${pct * 100}%` }} />
      </span>
      <button className="btn primary block hyd-plus" onClick={() => add(inc)}>+{inc} ml</button>
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
      {undo && (
        <div className="hyd-undo" role="status">
          <span>Added {undo.ml} ml</span>
          <button className="link" onClick={doUndo}>Undo</button>
        </div>
      )}
      {todays.length > 0 && (
        <>
          <button className="link small hyd-list-toggle" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
            Today's drinks ({todays.length}) {showList ? "▴" : "▾"}
          </button>
          {showList && (
            <ul className="hyd-list">
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
        </>
      )}
      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
