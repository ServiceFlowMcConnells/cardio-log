import { useState } from "react";
import type { NutritionData } from "../../lib/nutrition";
import { deleteTarget, fromYmd, loadNutrition, macroKcal, saveTarget, targetFor, todayYmd } from "../../lib/nutrition";
import { fmtKcal, num } from "./bits";

/** Calorie and macro targets from your coach. A change applies from the date you pick; earlier days keep the old targets. */
export default function TargetsEditor({ nutri, setNutri, onClose }: { nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose: () => void }) {
  const cur = targetFor(nutri.targets, todayYmd());
  const [from, setFrom] = useState(todayYmd());
  const [v, setV] = useState({ kcal: cur ? String(cur.kcal) : "", protein: cur?.protein != null ? String(cur.protein) : "", carbs: cur?.carbs != null ? String(cur.carbs) : "", fat: cur?.fat != null ? String(cur.fat) : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const k = num(v.kcal), p = num(v.protein), c = num(v.carbs), f = num(v.fat);
  const fromMacros = p != null && c != null && f != null ? macroKcal(p, c, f) : null;
  const valid = k != null && k >= 800 && k <= 8000 && /^\d{4}-\d{2}-\d{2}$/.test(from);

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      const fresh = await loadNutrition();
      setNutri(() => fresh);
      if (close) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const round = (x: number | null) => (x == null ? null : Math.round(x));

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Targets</h1>
          <p className="muted small">The numbers your coach gave you.</p>
        </div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <section className="panel grid">
        <label className="field"><span>Calories (kcal a day)</span><input className="input" inputMode="numeric" value={v.kcal} onChange={(e) => setV({ ...v, kcal: e.target.value })} placeholder="e.g. 2200" autoFocus={!cur} /></label>
        <div className="grid c3">
          {(["protein", "carbs", "fat"] as const).map((key) => (
            <label className="field" key={key}><span>{key[0].toUpperCase() + key.slice(1)} (g)</span><input className="input" inputMode="numeric" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} placeholder="optional" /></label>
          ))}
        </div>
        {fromMacros != null && k != null && Math.abs(fromMacros - k) > 60 && (
          <p className="small">Those macros come to {fmtKcal(fromMacros)} kcal ({fromMacros > k ? "+" : ""}{fmtKcal(fromMacros - k)} vs your calorie target). That's fine if your coach set them that way.</p>
        )}
        <label className="field"><span>Starting</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </section>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" disabled={!valid || busy} onClick={() => run(() => saveTarget({ effective_from: from, kcal: Math.round(k!), protein: round(p), carbs: round(c), fat: round(f) }))}>{busy ? "Saving…" : "Save targets"}</button>
      </div>

      {nutri.targets.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 8 }}>History</h2>
          <div className="panel list-panel">
            {[...nutri.targets].reverse().map((t) => (
              <div key={t.id} className="list-row">
                <span>
                  <strong>{fmtKcal(t.kcal)} kcal</strong>
                  <span className="small muted" style={{ display: "block" }}>
                    {[t.protein != null && `P ${t.protein} g`, t.carbs != null && `C ${t.carbs} g`, t.fat != null && `F ${t.fat} g`].filter(Boolean).join(" · ") || "Calories only"} · from {fromYmd(t.effective_from).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </span>
                <button className="link small" disabled={busy} onClick={() => run(() => deleteTarget(t.id), false)}>Delete</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
