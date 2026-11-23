import { useState } from "react";
import type { NutritionData } from "../../lib/nutrition";
import { addDays, dayOnlyTargets, deleteDayTarget, deleteTarget, fromYmd, loadNutrition, planTargets, saveDayTargets, saveTarget, targetFor, todayYmd } from "../../lib/nutrition";
import { MacroInputs, fmtKcal, formKcal, macroForm, num } from "./bits";
import { DateField } from "./Pickers";

/** Calorie and macro targets from your coach. A change applies from the date you pick; earlier days keep the old targets. */
export default function TargetsEditor({ nutri, setNutri, onClose }: { nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose: () => void }) {
  const plan = planTargets(nutri.targets);
  const cur = targetFor(plan, todayYmd());
  // One-off days: the same macros on any days you pick, replacing the plan on those days only
  const [oneOff, setOneOff] = useState(() => macroForm(cur));
  const [oneDays, setOneDays] = useState<Set<string>>(new Set());
  const [oneNote, setOneNote] = useState("Refeed");
  const ok = formKcal(oneOff), op = num(oneOff.protein), oc = num(oneOff.carbs), of = num(oneOff.fat);
  const oneValid = oneDays.size > 0 && ok != null && ok >= 500 && ok <= 10000 && (oneOff.manual || (op != null && oc != null && of != null));
  const pickable = Array.from({ length: 21 }, (_, i) => addDays(todayYmd(), i - 1));
  const existing = dayOnlyTargets(nutri.targets).filter((t) => t.effective_from >= addDays(todayYmd(), -14));
  const hasOneOff = (d: string) => existing.some((t) => t.effective_from === d);
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
        <div className="field"><span>Starting</span><DateField value={from} onChange={setFrom} label="Starting" title="Target starts" /></div>
      </section>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" disabled={!valid || busy} onClick={() => run(() => saveTarget({ effective_from: from, kcal: Math.round(k!), protein: round(p), carbs: round(c), fat: round(f) }))}>{busy ? "Saving…" : "Save targets"}</button>
      </div>

      <section className="section">
        <h2 style={{ marginBottom: 4 }}>One-off days</h2>
        <p className="small muted" style={{ margin: "0 0 8px" }}>For a refeed or a special day: these macros replace your plan on the days you pick, and only those days. Everything else stays as it is.</p>
        <div className="panel grid">
          <div className="oneoff-days" role="group" aria-label="Days">
            {pickable.map((d) => {
              const on = oneDays.has(d), dt = fromYmd(d);
              return (
                <button key={d} type="button" className={`oneoff-day${on ? " on" : ""}${hasOneOff(d) ? " set" : ""}`} aria-pressed={on}
                  onClick={() => setOneDays((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}>
                  <span className="small">{d === todayYmd() ? "Today" : dt.toLocaleDateString("en-IE", { weekday: "short" })}</span>
                  <strong className="num">{dt.getDate()}</strong>
                </button>
              );
            })}
          </div>
          <MacroInputs v={oneOff} set={setOneOff} kcalLabel="Calories that day" />
          <label className="field"><span>Label</span><input className="input" value={oneNote} maxLength={30} onChange={(e) => setOneNote(e.target.value)} placeholder="e.g. Refeed" /></label>
          <button className="btn primary block" disabled={!oneValid || busy} onClick={() => run(async () => {
            await saveDayTargets([...oneDays].sort(), { kcal: Math.round(ok!), protein: round(op), carbs: round(oc), fat: round(of), note: oneNote.trim() || null });
            setOneDays(new Set());
          }, false)}>
            {oneDays.size ? `Set for ${oneDays.size} day${oneDays.size === 1 ? "" : "s"}` : "Pick the days above"}
          </button>
        </div>
        {existing.length > 0 && (
          <div className="panel list-panel" style={{ marginTop: 8 }}>
            {existing.map((t) => (
              <div key={t.id} className="list-row">
                <span>
                  <strong>{fromYmd(t.effective_from).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}{t.note ? ` · ${t.note}` : ""}</strong>
                  <span className="small muted" style={{ display: "block" }}>
                    {fmtKcal(t.kcal)} kcal · {[t.protein != null && `P ${t.protein} g`, t.carbs != null && `C ${t.carbs} g`, t.fat != null && `F ${t.fat} g`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <button className="link small" disabled={busy} onClick={() => run(() => deleteDayTarget(t.id), false)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {plan.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 8 }}>History</h2>
          <div className="panel list-panel">
            {[...plan].reverse().map((t) => (
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
