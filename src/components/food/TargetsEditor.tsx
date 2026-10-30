import { useState } from "react";
import type { NutritionData } from "../../lib/nutrition";
import { deleteTarget, fromYmd, loadNutrition, saveTarget, targetFor, todayYmd } from "../../lib/nutrition";
import { MacroInputs, fmtKcal, formKcal, macroForm, num } from "./bits";

/** Calorie and macro targets from your coach. A change applies from the date you pick; earlier days keep the old targets. */
export default function TargetsEditor({ nutri, setNutri, onClose }: { nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose: () => void }) {
  const cur = targetFor(nutri.targets, todayYmd());
  const [from, setFrom] = useState(todayYmd());
  const [v, setV] = useState(() => macroForm(cur));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const k = formKcal(v), p = num(v.protein), c = num(v.carbs), f = num(v.fat);
  const valid = k != null && k >= 800 && k <= 8000 && (v.manual || (p != null && c != null && f != null)) && /^\d{4}-\d{2}-\d{2}$/.test(from);

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
        <p className="small muted">Enter the grams your coach gave you; calories are worked out from them.</p>
        <MacroInputs v={v} set={setV} autoFocus={!cur} kcalLabel="Calories a day" />
        {k != null && (k < 800 || k > 8000) && <p className="small error">That's {fmtKcal(k)} kcal a day. Check the numbers.</p>}
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
