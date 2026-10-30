import { useState } from "react";
import type { Food, Macros, NutritionData, Recipe } from "../../lib/nutrition";
import { macrosFor, perServing, scaleMacros } from "../../lib/nutrition";
import { MacroLine } from "./bits";

/** Something being logged: one of your foods (or a database food not saved yet), or a recipe. */
export type Loggable =
  | { type: "food"; food: Pick<Food, "name" | "brand" | "kcal" | "protein" | "carbs" | "fat" | "serving_g" | "serving_label">; id: string | null; note?: string }
  | { type: "recipe"; recipe: Recipe };

export function defaultAmount(item: Loggable, nutri: NutritionData): { amount: number; unit: "g" | "serving" } {
  const last = [...nutri.log].reverse().find((e) => (item.type === "food" ? item.id && e.food_id === item.id : e.recipe_id === item.recipe.id));
  if (last) return { amount: last.amount, unit: item.type === "recipe" ? "serving" : last.unit === "serving" && item.food.serving_g ? "serving" : "g" };
  if (item.type === "recipe") return { amount: 1, unit: "serving" };
  return item.food.serving_g ? { amount: 1, unit: "serving" } : { amount: 100, unit: "g" };
}

export function macrosOf(item: Loggable, nutri: NutritionData, amount: number, unit: "g" | "serving"): Macros {
  return item.type === "recipe" ? scaleMacros(perServing(item.recipe, nutri.foods), amount) : macrosFor(item.food, amount, unit);
}

const servingText = (f: { serving_g: number | null; serving_label: string | null }) => (f.serving_label ? `${f.serving_label}${/\d\s*g\b/.test(f.serving_label) ? "" : ` (${Math.round((f.serving_g ?? 0) * 10) / 10} g)`}` : `serving (${f.serving_g} g)`);
/** "1 wrap (62 g)" → "1 wrap" for the unit button. */
const shortServing = (f: { serving_label: string | null }) => {
  const s = (f.serving_label ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  return s && s.length <= 14 ? s : "Serving";
};

export default function AmountPanel({ item, nutri, actionLabel, busy, onAdd, onBack, onEdit, initial, onSetServing }: {
  item: Loggable;
  nutri: NutritionData;
  actionLabel: string;
  busy?: boolean;
  onAdd: (amount: number, unit: "g" | "serving", macros: Macros) => void;
  onBack: () => void;
  onEdit?: () => void;
  initial?: { amount: number; unit: "g" | "serving" };
  /** Save a portion size ("1 wrap" = 62 g) on this food. */
  onSetServing?: (label: string, grams: number) => Promise<void>;
}) {
  const [portion, setPortion] = useState<null | { label: string; grams: string; busy?: boolean; error?: string }>(null);
  const start = initial ?? defaultAmount(item, nutri);
  const [amount, setAmount] = useState(String(start.amount));
  const [unit, setUnit] = useState<"g" | "serving">(start.unit);
  const a = parseFloat(amount.replace(",", "."));
  const ok = Number.isFinite(a) && a > 0;
  const m = ok ? macrosOf(item, nutri, a, unit) : null;
  const canServe = item.type === "recipe" || Boolean(item.food.serving_g);
  const name = item.type === "recipe" ? item.recipe.name : item.food.name;
  const brand = item.type === "food" ? item.food.brand : null;

  const setUnitKeep = (u: "g" | "serving") => {
    if (u === unit || item.type !== "food" || !item.food.serving_g) return setUnit(u);
    // Keep the same quantity when switching units
    if (ok) setAmount(String(u === "g" ? Math.round(a * item.food.serving_g) : Math.round((a / item.food.serving_g) * 100) / 100));
    setUnit(u);
  };

  return (
    <section className="panel amount-panel">
      <button className="link small" onClick={onBack}>‹ Back</button>
      <h2 style={{ marginTop: 8 }}>{name}</h2>
      {brand && <p className="muted small">{brand}</p>}
      {item.type === "food" && item.note && <p className="muted small">{item.note}</p>}

      <div className="amount-row">
        <label className="field" style={{ flex: 1 }}>
          <span>{unit === "g" ? "Grams (or ml)" : item.type === "recipe" ? "Servings" : `Servings: ${servingText(item.food)}`}</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Amount" />
        </label>
        {item.type === "food" && canServe && (
          <div className="seg unit-seg" role="group" aria-label="Unit">
            <button className={unit === "serving" ? "on" : ""} aria-pressed={unit === "serving"} onClick={() => setUnitKeep("serving")}>{shortServing(item.food)}</button>
            <button className={unit === "g" ? "on" : ""} aria-pressed={unit === "g"} onClick={() => setUnitKeep("g")}>g</button>
          </div>
        )}
      </div>
      <div className="chip-row">
        {(unit === "serving" ? [0.5, 1, 1.5, 2] : [50, 100, 150, 200]).map((v) => (
          <button key={v} className={`fchip${ok && a === v ? " on" : ""}`} onClick={() => setAmount(String(v))}>{unit === "serving" ? (v === 0.5 ? "½" : v === 1.5 ? "1½" : v) : `${v} g`}</button>
        ))}
      </div>

      {item.type === "food" && !item.food.serving_g && onSetServing && (
        portion ? (
          <form className="portion-form" onSubmit={async (e) => {
            e.preventDefault();
            const g = parseFloat(portion.grams.replace(",", "."));
            if (!portion.label.trim() || !(g > 0)) return;
            setPortion({ ...portion, busy: true, error: undefined });
            try { await onSetServing(portion.label.trim(), g); } catch (err) { setPortion({ ...portion, busy: false, error: err instanceof Error ? err.message : "Couldn't save." }); }
          }}>
            <label className="field"><span>Portion</span><input className="input" value={portion.label} onChange={(e) => setPortion({ ...portion, label: e.target.value })} placeholder="1 wrap" autoFocus /></label>
            <label className="field"><span>Weighs (g)</span><input className="input" inputMode="decimal" value={portion.grams} onChange={(e) => setPortion({ ...portion, grams: e.target.value })} placeholder="62" /></label>
            <button className="btn dark" disabled={portion.busy || !portion.label.trim() || !(parseFloat(portion.grams.replace(",", ".")) > 0)}>{portion.busy ? "…" : "Save"}</button>
            <p className="muted small" style={{ gridColumn: "1 / -1" }}>From the pack, e.g. 8 wraps in a 496 g pack is 62 g each. Saved on this food for next time.</p>
            {portion.error && <p className="error" style={{ gridColumn: "1 / -1" }}>{portion.error}</p>}
          </form>
        ) : (
          <button className="link small portion-link" onClick={() => setPortion({ label: "1 ", grams: "" })}>+ Add a portion size (e.g. 1 wrap, 1 slice)</button>
        )
      )}

      <div className="amount-macros">{m ? <MacroLine m={m} big /> : <span className="muted small">Enter an amount</span>}</div>

      <button className="btn primary block" disabled={!m || busy} onClick={() => m && onAdd(a, item.type === "recipe" ? "serving" : unit, m)}>{busy ? "Adding…" : actionLabel}</button>
      {onEdit && <button className="link small" style={{ marginTop: 12 }} onClick={onEdit}>Edit {item.type === "recipe" ? "recipe" : "food"}</button>}
    </section>
  );
}
