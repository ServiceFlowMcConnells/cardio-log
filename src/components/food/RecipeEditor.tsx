import { useState } from "react";
import type { Food, NutritionData, Recipe, RecipeItem } from "../../lib/nutrition";
import { adoptFood, deleteRecipe, loadNutrition, recipeTotals, saveRecipe, scaleMacros } from "../../lib/nutrition";
import FoodSearch, { type Picked } from "./FoodSearch";
import { MacroLine, fmtG, fmtKcal, num } from "./bits";

type Row = { food_id: string; grams: string };

/** Build a recipe from your foods: total it up and split it into servings. */
export default function RecipeEditor({ recipe, nutri, setNutri, onClose, onSaved }: {
  recipe: Recipe | null;
  nutri: NutritionData;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 1));
  const [notes, setNotes] = useState(recipe?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(recipe?.items.map((i) => ({ food_id: i.food_id, grams: fmtG(i.grams) })) ?? []);
  const [adding, setAdding] = useState(!recipe);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const foodsById = new Map(nutri.foods.map((f) => [f.id, f]));
  const items: RecipeItem[] = rows.map((r, position) => ({ food_id: r.food_id, grams: num(r.grams) ?? 0, position })).filter((i) => i.grams > 0);
  const total = recipeTotals({ items }, nutri.foods);
  const sv = num(servings);
  const svOk = sv != null && sv > 0;
  const valid = name.trim().length > 0 && items.length > 0 && svOk;

  async function pick(p: Picked) {
    setError(null);
    let food: Food;
    if (p.type === "food") food = p.food;
    else if (p.type === "db") {
      try {
        const adopted = await adoptFood(p.db, nutri.foods);
        food = adopted;
        setNutri((n) => ({ ...n, foods: n.foods.some((f) => f.id === adopted.id) ? n.foods.map((f) => (f.id === adopted.id ? adopted : f)) : [...n.foods, adopted] }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that food.");
        return;
      }
    } else return;
    setRows((r) => [...r, { food_id: food.id, grams: food.serving_g ? fmtG(food.serving_g) : "100" }]);
    setQuery("");
    setAdding(false);
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await saveRecipe({ id: recipe?.id, name, servings: sv!, notes: notes || null, items });
      const fresh = await loadNutrition();
      setNutri(() => fresh);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!recipe) return;
    setBusy(true);
    try {
      await deleteRecipe(recipe.id);
      setNutri((n) => ({ ...n, recipes: n.recipes.filter((r) => r.id !== recipe.id) }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>{recipe ? "Edit recipe" : "New recipe"}</h1>
          <p className="muted small">Weigh the ingredients raw, then split it into servings.</p>
        </div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <section className="panel grid">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Overnight oats" /></label>
        <label className="field"><span>Makes how many servings?</span><input className="input" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} /></label>
      </section>

      <section className="section">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2>Ingredients</h2>
          {!adding && <button className="link small" onClick={() => setAdding(true)}>+ Add ingredient</button>}
        </div>
        {rows.length > 0 && (
          <div className="panel list-panel">
            {rows.map((r, i) => {
              const f = foodsById.get(r.food_id);
              const g = num(r.grams) ?? 0;
              return (
                <div key={i} className="list-row ing-row">
                  <span style={{ minWidth: 0 }}>
                    <strong>{f?.name ?? "Removed food"}</strong>{f?.brand && <span className="muted"> · {f.brand}</span>}
                    {f && <span className="small muted" style={{ display: "block" }}>{fmtKcal((f.kcal * g) / 100)} kcal · P {fmtG((f.protein * g) / 100)}</span>}
                  </span>
                  <span className="ing-g">
                    <input className="cell" inputMode="decimal" value={r.grams} aria-label={`Grams of ${f?.name ?? "ingredient"}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))} />
                    <span className="small muted">g</span>
                    <button className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {adding && (
          <div className="panel" style={{ marginTop: 10 }}>
            <FoodSearch nutri={nutri} onPick={pick} recipes={false} query={query} setQuery={setQuery} autoFocus />
            {rows.length > 0 && <button className="link small" style={{ marginTop: 10 }} onClick={() => { setAdding(false); setQuery(""); }}>Close search</button>}
          </div>
        )}
      </section>

      {items.length > 0 && (
        <section className="section panel">
          <h2 style={{ marginBottom: 6 }}>Per serving</h2>
          {svOk ? <MacroLine m={scaleMacros(total, 1 / sv!)} big /> : <span className="muted">Enter the number of servings</span>}
          <p className="muted small" style={{ marginTop: 6 }}>Whole recipe: {fmtKcal(total.kcal)} kcal, {fmtG(total.grams)} g of ingredients.</p>
        </section>
      )}

      <label className="field section"><span>Notes (optional)</span><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Save recipe"}</button>
        {recipe && <button className="btn danger block" disabled={busy} onClick={remove}>Delete recipe</button>}
      </div>
    </>
  );
}
