import { useState } from "react";
import type { Settings } from "../lib/types";
import { saveSettings } from "../lib/data";
import { WATER_AMOUNTS, litres } from "../lib/hydration";
import { pinWidget, widgetSettingsChanged, widgetSupported } from "../lib/widget";

/** Settings > Hydration: daily target and the + amount. Saved on each change, and pushed straight to the widget. */
export default function HydrationSettings({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [custom, setCustom] = useState(WATER_AMOUNTS.includes(settings.water_increment_ml) ? "" : String(settings.water_increment_ml));
  const t = settings.water_target_ml, inc = settings.water_increment_ml;

  async function save(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    onSaved(next);
    widgetSettingsChanged(next);
    setMsg(null);
    try { await saveSettings(next); setMsg({ ok: true, text: "Saved." }); }
    catch (e) { onSaved(settings); widgetSettingsChanged(settings); setMsg({ ok: false, text: e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save." }); }
  }
  const setTarget = (ml: number) => save({ water_target_ml: Math.max(1000, Math.min(6000, Math.round(ml / 250) * 250)) });
  const cm = parseInt(custom, 10);

  return (
    <section className="section panel stack">
      <h2>Hydration</h2>
      <div className="hyd-set-row">
        <span>Daily target</span>
        <div className="hyd-stepper">
          <button type="button" className="icon-btn" aria-label="Lower target by 0.25 litres" disabled={t <= 1000} onClick={() => setTarget(t - 250)}>−</button>
          <strong className="num" aria-live="polite">{litres(t)} L</strong>
          <button type="button" className="icon-btn" aria-label="Raise target by 0.25 litres" disabled={t >= 6000} onClick={() => setTarget(t + 250)}>+</button>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span>Quick add amount <span className="muted small">(the + button and the widget)</span></span>
        <div className="hyd-chips" role="radiogroup" aria-label="Quick add amount">
          {WATER_AMOUNTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={inc === a} className={`fchip${inc === a ? " on" : ""}`} onClick={() => { setCustom(""); void save({ water_increment_ml: a }); }}>{a} ml</button>
          ))}
        </div>
        <form className="hyd-custom" onSubmit={(e) => { e.preventDefault(); if (cm >= 10 && cm <= 2000) void save({ water_increment_ml: cm }); }}>
          <span className="weigh-input"><input className="input" inputMode="numeric" placeholder="Custom" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Custom quick add amount in ml" /><span className="weigh-unit">ml</span></span>
          <button className="btn" disabled={!(cm >= 10 && cm <= 2000) || cm === inc}>Use</button>
        </form>
      </div>
      {widgetSupported() && (
        <button className="btn block" onClick={async () => { const ok = await pinWidget(); setMsg(ok ? { ok: true, text: "Confirm on the next screen to add the widget." } : { ok: false, text: "Your launcher can't add it from here: long-press the home screen → Widgets → Kata." }); }}>
          Add the water widget to your home screen
        </button>
      )}
      {msg && <p className={msg.ok ? "ok small" : "error small"} role="status" style={{ margin: 0 }}>{msg.text}</p>}
    </section>
  );
}
