import { useState } from "react";
import type { Food, Macros, NutritionData, Recipe, Unit } from "../../lib/nutrition";
import { UNIT_LABEL, VOLUME_UNITS, WEIGHT_UNITS, baseUnit, convertAmount, isVolume, macrosFor, perServing, scaleMacros } from "../../lib/nutrition";
import { MacroLine, fmtG } from "./bits";

/** Something being logged: one of your foods (or a database food not saved yet), or a recipe. */
export type Loggable =
  | { type: "food"; food: Pick<Food, "name" | "brand" | "kcal" | "protein" | "carbs" | "fat" | "serving_g" | "serving_label"> & { liquid?: boolean }; id: string | null; note?: string }
  | { type: "recipe"; recipe: Recipe };

export function defaultAmount(item: Loggable, nutri: NutritionData): { amount: number; unit: Unit } {
  const last = [...nutri.log].reverse().find((e) => (item.type === "food" ? item.id && e.food_id === item.id : e.recipe_id === item.recipe.id));
  if (item.type === "recipe") return { amount: last?.amount ?? 1, unit: "serving" };
  const f = item.food;
  if (last) {
    if (last.unit === "serving") return f.serving_g ? { amount: last.amount, unit: "serving" } : { amount: last.amount, unit: baseUnit(f) };
    // Older entries for a drink were saved "in g": show them as ml
    return { amount: last.amount, unit: last.unit === "g" && f.liquid ? "ml" : last.unit };
  }
  return f.serving_g ? { amount: 1, unit: "serving" } : { amount: 100, unit: baseUnit(f) };
}

/** "50 g", "130 ml", "2 tbsp", "1 wrap", "2 × slice", "1 serving". */
export function amountLabel(f: { serving_label: string | null; liquid?: boolean } | null, amount: number, unit: Unit): string {
  if (unit !== "serving") {
    const u = unit === "g" && f?.liquid ? "ml" : unit;
    return `${fmtG(amount)} ${UNIT_LABEL[u]}${u === "cup" && amount !== 1 ? "s" : ""}`;
  }
  const lbl = (f?.serving_label ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (!lbl) return `${fmtG(amount)} serving${amount === 1 ? "" : "s"}`;
  if (amount === 1) return lbl;
  const one = /^1\s+(.+)$/.exec(lbl); // "1 slice" → "2 slices"
  if (one) return `${fmtG(amount)} ${one[1]}${/s$/i.test(one[1]) ? "" : "s"}`;
  return `${fmtG(amount)} × ${lbl}`;
}

/** Unit chips above the amount, like MacroFactor: ml · tbsp · tsp · fl oz · cup for drinks, g · oz · lb for food,
 *  plus the food's serving. ⇅ swaps between weight and volume. */
export function UnitPicker({ food, unit, onChange, compact }: { food: { serving_g: number | null; serving_label: string | null; liquid?: boolean }; unit: Unit; onChange: (u: Unit) => void; compact?: boolean }) {
  const [vol, setVol] = useState(unit === "serving" ? Boolean(food.liquid) : isVolume(unit));
  const set = vol ? VOLUME_UNITS : WEIGHT_UNITS;
  const swap = () => { const v = !vol; setVol(v); if (unit !== "serving") onChange(v ? "ml" : "g"); };
  return (
    <div className={`unit-pick${compact ? " compact" : ""}`} role="group" aria-label="Unit">
      <button type="button" className="unit-swap" aria-label={vol ? "Switch to weight" : "Switch to volume"} title={vol ? "Weight (g, oz)" : "Volume (ml, cups)"} onClick={swap}>⇅</button>
      {set.map((u) => <button type="button" key={u} className={`unit-chip${unit === u ? " on" : ""}`} aria-pressed={unit === u} onClick={() => onChange(u)}>{UNIT_LABEL[u]}</button>)}
      {food.serving_g ? <><span className="unit-div" /><button type="button" className={`unit-chip${unit === "serving" ? " on" : ""}`} aria-pressed={unit === "serving"} onClick={() => onChange("serving")}>{shortServing(food)}</button></> : null}
    </div>
  );
}

/** Quick amounts for a unit. */
export const presetsFor = (u: Unit): number[] => (u === "g" || u === "ml" ? [50, 100, 150, 200] : u === "oz" || u === "floz" ? [1, 2, 4, 8] : u === "lb" ? [0.25, 0.5, 1, 2] : u === "tsp" || u === "tbsp" ? [1, 2, 3, 4] : [0.5, 1, 1.5, 2]);
const presetText = (v: number, u: Unit) => (v === 0.5 ? "½" : v === 1.5 ? "1½" : v === 0.25 ? "¼" : String(v)) + (u === "serving" ? "" : ` ${UNIT_LABEL[u]}`);

/** What a search or list row shows: the macros for the amount you'd most likely log (your last amount, else a
 *  serving, else 100 g), and that amount. */
export function defaultLine(item: Loggable, nutri: NutritionData): { m: Macros; amount: string } {
  const d = defaultAmount(item, nutri);
  return { m: macrosOf(item, nutri, d.amount, d.unit), amount: item.type === "recipe" ? `${fmtG(d.amount)} serving${d.amount === 1 ? "" : "s"}` : amountLabel(item.food, d.amount, d.unit) };
}

export function macrosOf(item: Loggable, nutri: NutritionData, amount: number, unit: Unit): Macros {
  return item.type === "recipe" ? scaleMacros(perServing(item.recipe, nutri.foods), amount) : macrosFor(item.food, amount, unit);
}

const servingText = (f: { serving_g: number | null; serving_label: string | null; liquid?: boolean }) => { const u = f.liquid ? "ml" : "g"; return f.serving_label ? `${f.serving_label}${/\d\s*(g|ml)\b/.test(f.serving_label) ? "" : ` (${Math.round((f.serving_g ?? 0) * 10) / 10} ${u})`}` : `serving (${f.serving_g} ${u})`; };
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
  onAdd: (amount: number, unit: Unit, macros: Macros) => void;
  onBack: () => void;
  onEdit?: () => void;
  initial?: { amount: number; unit: Unit };
  /** Save a portion size ("1 wrap" = 62 g) on this food. */
  onSetServing?: (label: string, grams: number) => Promise<void>;
}) {
  const [portion, setPortion] = useState<null | { label: string; grams: string; busy?: boolean; error?: string }>(null);
  const start = initial ?? defaultAmount(item, nutri);
  const [amount, setAmount] = useState(String(start.amount));
  const [unit, setUnit] = useState<Unit>(start.unit);
  const a = parseFloat(amount.replace(",", "."));
  const ok = Number.isFinite(a) && a > 0;
  const m = ok ? macrosOf(item, nutri, a, unit) : null;
  const name = item.type === "recipe" ? item.recipe.name : item.food.name;
  const brand = item.type === "food" ? item.food.brand : null;

  // Keep the same quantity when switching units
  const setUnitKeep = (u: Unit) => {
    if (item.type === "food" && ok) setAmount(String(convertAmount(item.food, a, unit, u)));
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
          <span>{item.type === "recipe" ? "Servings" : unit === "serving" ? `Servings: ${servingText(item.food)}` : `Amount (${UNIT_LABEL[unit]})`}</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Amount" />
        </label>
      </div>
      {item.type === "food" && <UnitPicker food={item.food} unit={unit} onChange={setUnitKeep} />}
      <div className="chip-row">
        {presetsFor(item.type === "recipe" ? "serving" : unit).map((v) => (
          <button key={v} className={`fchip${ok && a === v ? " on" : ""}`} onClick={() => setAmount(String(v))}>{presetText(v, item.type === "recipe" ? "serving" : unit)}</button>
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
            <label className="field"><span>{item.type === "food" && item.food.liquid ? "Volume (ml)" : "Weighs (g)"}</span><input className="input" inputMode="decimal" value={portion.grams} onChange={(e) => setPortion({ ...portion, grams: e.target.value })} placeholder="62" /></label>
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
