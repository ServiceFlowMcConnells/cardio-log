import { useState } from "react";
import type { Food, NutritionData } from "../../lib/nutrition";
import { saveFood, setFoodFlags } from "../../lib/nutrition";
import { num } from "./bits";

type Basis = "100g" | "serving";
const KEYS = ["kcal", "protein", "carbs", "fat", "fibre"] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key, string> = { kcal: "Calories (kcal)", protein: "Protein (g)", carbs: "Carbohydrate (g)", fat: "Fat (g)", fibre: "Fibre (g, optional)" };

const show = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 10) / 10));

/** Create or edit one of your foods, typed in from the label (per 100 g or per serving). */
export default function FoodEditor({ food, initialName, setNutri, onClose, onSaved }: {
  food: Food | null;
  initialName?: string;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onClose: () => void;
  onSaved: (f: Food) => void;
}) {
  const [name, setName] = useState(food?.name ?? initialName ?? "");
  const [brand, setBrand] = useState(food?.brand ?? "");
  const [servingG, setServingG] = useState(show(food?.serving_g));
  const [servingLabel, setServingLabel] = useState(food?.serving_label ?? "");
  const [basis, setBasis] = useState<Basis>("100g");
  const [vals, setVals] = useState<Record<Key, string>>(() => Object.fromEntries(KEYS.map((k) => [k, show(food ? food[k] : null)])) as Record<Key, string>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sg = num(servingG);
  const servingOk = sg != null && sg > 0;
  const switchBasis = (b: Basis) => {
    if (b === basis) return;
    if (!servingOk) { setBasis(b); return; }
    const f = b === "serving" ? sg! / 100 : 100 / sg!;
    setVals((v) => Object.fromEntries(KEYS.map((k) => { const x = num(v[k]); return [k, x == null ? "" : show(x * f)]; })) as Record<Key, string>);
    setBasis(b);
  };

  const per100 = (k: Key) => {
    const x = num(vals[k]);
    if (x == null) return null;
    return basis === "serving" ? (servingOk ? (x * 100) / sg! : null) : x;
  };
  const kcal = per100("kcal");
  const macroK = (per100("protein") ?? 0) * 4 + (per100("carbs") ?? 0) * 4 + (per100("fat") ?? 0) * 9;
  const mismatch = kcal != null && kcal > 20 && macroK > 0 && Math.abs(macroK - kcal) / kcal > 0.2;
  const valid = name.trim().length > 0 && kcal != null && kcal >= 0 && (basis === "100g" || servingOk);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const f = await saveFood({
        name, brand: brand || null, source: food?.source ?? "custom", source_ref: food?.source_ref ?? null, barcode: food?.barcode ?? null,
        kcal: kcal!, protein: per100("protein") ?? 0, carbs: per100("carbs") ?? 0, fat: per100("fat") ?? 0, fibre: per100("fibre"),
        serving_g: servingOk ? sg : null, serving_label: servingOk ? servingLabel || null : null,
      }, food?.id);
      setNutri((n) => ({ ...n, foods: n.foods.some((x) => x.id === f.id) ? n.foods.map((x) => (x.id === f.id ? f : x)) : [...n.foods, f] }));
      onSaved(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!food) return;
    setBusy(true);
    try {
      await setFoodFlags(food.id, { archived: true });
      setNutri((n) => ({ ...n, foods: n.foods.map((x) => (x.id === food.id ? { ...x, archived: true } : x)) }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>{food ? "Edit food" : "New food"}</h1>
          <p className="muted small">Type it in from the nutrition label.</p>
        </div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <section className="panel grid">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Protein yoghurt, strawberry" autoFocus={!food} /></label>
        <label className="field"><span>Brand (optional)</span><input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Glenisk" /></label>
        <div className="grid c2">
          <label className="field"><span>Serving size (g or ml)</span><input className="input" inputMode="decimal" value={servingG} onChange={(e) => setServingG(e.target.value)} placeholder="optional" /></label>
          <label className="field"><span>Serving name</span><input className="input" value={servingLabel} onChange={(e) => setServingLabel(e.target.value)} placeholder="e.g. 1 pot, 1 slice" disabled={!servingOk} /></label>
        </div>
      </section>

      <section className="section panel">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>Nutrition</h2>
          <div className="seg" role="group" aria-label="Label values are" style={{ minWidth: 200 }}>
            <button className={basis === "100g" ? "on" : ""} aria-pressed={basis === "100g"} onClick={() => switchBasis("100g")}>Per 100 g</button>
            <button className={basis === "serving" ? "on" : ""} aria-pressed={basis === "serving"} disabled={!servingOk} onClick={() => switchBasis("serving")}>Per serving</button>
          </div>
        </div>
        <div className="grid c2">
          {KEYS.map((k) => (
            <label className="field" key={k} style={k === "kcal" ? { gridColumn: "1 / -1" } : undefined}>
              <span>{LABEL[k]}</span>
              <input className="input" inputMode="decimal" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        {basis === "serving" && kcal != null && <p className="muted small" style={{ marginTop: 8 }}>Saved as {Math.round(kcal)} kcal per 100 g.</p>}
        {mismatch && <p className="small" style={{ marginTop: 8 }}>Protein, carbs and fat add up to about {Math.round(macroK)} kcal per 100 g, not {Math.round(kcal!)}. Worth checking the label (fibre and alcohol can explain a small gap).</p>}
      </section>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : food ? "Save changes" : "Save food"}</button>
        {food && <button className="btn danger block" disabled={busy} onClick={remove}>Remove from my foods</button>}
      </div>
      {food && <p className="muted small" style={{ marginTop: 8 }}>Changes apply to future logs. Days you've already logged keep their numbers.</p>}
    </>
  );
}
