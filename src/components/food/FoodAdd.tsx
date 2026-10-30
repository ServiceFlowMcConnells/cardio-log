import { useEffect, useMemo, useRef, useState } from "react";
import type { Food, MealIndex, NewEntry, NutritionData, Recipe, RecentItem } from "../../lib/nutrition";
import { MEALS, addEntries, adoptFood, fromYmd, macrosFor, perServing, recentItems, roundMacros, scaleMacros, setFoodFlags, setRecipeFavorite, todayYmd } from "../../lib/nutrition";
import { useDesktop } from "../../lib/desktop";
import FoodSearch, { type Picked } from "./FoodSearch";
import AmountPanel, { type Loggable } from "./AmountPanel";
import { MacroLine, PlusIcon, Star, fmtG, fmtKcal, num } from "./bits";

type Tab = "recent" | "saved" | "recipes";
type Sel = { item: Loggable; db?: Picked & { type: "db" } };

interface Props {
  nutri: NutritionData;
  day: string;
  meal: MealIndex;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onDone: () => void;
  onNewFood: (name: string) => void;
  onEditFood: (f: Food) => void;
  onNewRecipe: () => void;
  onEditRecipe: (r: Recipe) => void;
  preselect?: string | null; // a food id just created
}

const dayName = (d: string) => (d === todayYmd() ? "today" : fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" }));

export default function FoodAdd({ nutri, day, meal: meal0, setNutri, onDone, onNewFood, onEditFood, onNewRecipe, onEditRecipe, preselect }: Props) {
  const desktop = useDesktop();
  const [meal, setMeal] = useState<MealIndex>(meal0);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const [sel, setSel] = useState<Sel | null>(null);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    if (!preselect) return;
    const f = nutri.foods.find((x) => x.id === preselect);
    if (f) setSel({ item: { type: "food", food: f, id: f.id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  const recents = useMemo(() => recentItems(nutri.log, nutri.foods, nutri.recipes), [nutri]);
  const saved = useMemo(() => nutri.foods.filter((f) => !f.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)), [nutri.foods]);
  const recipes = useMemo(() => [...nutri.recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)), [nutri.recipes]);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2200);
  };

  async function log(entries: NewEntry[], newFood?: Food) {
    setBusy(true);
    setError(null);
    try {
      const added = await addEntries(entries);
      setNutri((n) => ({ ...n, foods: newFood && !n.foods.some((f) => f.id === newFood.id) ? [...n.foods, newFood] : n.foods.map((f) => (newFood && f.id === newFood.id ? newFood : f)), log: [...n.log, ...added] }));
      flash(`Added ${entries.length === 1 ? entries[0].name : `${entries.length} items`} to ${MEALS[meal].toLowerCase()}`);
      setSel(null);
      setQuick(false);
      setQuery("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const base = { eaten_on: day, meal } as const;

  function readd(r: RecentItem) {
    if (r.kind === "food") {
      const f = nutri.foods.find((x) => x.id === r.id);
      if (!f) return;
      log([{ ...base, kind: "food", food_id: f.id, recipe_id: null, name: f.name, amount: r.amount, unit: r.unit, ...macrosFor(f, r.amount, r.unit) }]);
    } else if (r.kind === "recipe") {
      const rec = nutri.recipes.find((x) => x.id === r.id);
      if (!rec) return;
      log([{ ...base, kind: "recipe", food_id: null, recipe_id: rec.id, name: rec.name, amount: r.amount, unit: "serving", ...scaleMacros(perServing(rec, nutri.foods), r.amount) }]);
    } else {
      log([{ ...base, kind: "quick", food_id: null, recipe_id: null, name: r.name, amount: 1, unit: "serving", ...r.macros }]);
    }
  }

  function openRecent(r: RecentItem) {
    if (r.kind === "food") {
      const f = nutri.foods.find((x) => x.id === r.id);
      if (f) setSel({ item: { type: "food", food: f, id: f.id } });
    } else if (r.kind === "recipe") {
      const rec = nutri.recipes.find((x) => x.id === r.id);
      if (rec) setSel({ item: { type: "recipe", recipe: rec } });
    } else readd(r);
  }

  function pick(p: Picked) {
    if (p.type === "food") setSel({ item: { type: "food", food: p.food, id: p.food.id } });
    else if (p.type === "recipe") setSel({ item: { type: "recipe", recipe: p.recipe } });
    else {
      const mine = nutri.foods.find((f) => f.source === p.db.source && f.source_ref === p.db.ref);
      setSel(mine ? { item: { type: "food", food: mine, id: mine.id } } : { item: { type: "food", food: p.db, id: null, note: p.db.source === "cofid" ? "McCance & Widdowson (CoFID 2021)" : "Open Food Facts" }, db: p });
    }
  }

  async function addSelected(amount: number, unit: "g" | "serving") {
    if (!sel) return;
    const it = sel.item;
    if (it.type === "recipe") {
      await log([{ ...base, kind: "recipe", food_id: null, recipe_id: it.recipe.id, name: it.recipe.name, amount, unit: "serving", ...scaleMacros(perServing(it.recipe, nutri.foods), amount) }]);
      return;
    }
    let food: Food | undefined = it.id ? nutri.foods.find((f) => f.id === it.id) : undefined;
    let adopted: Food | undefined;
    if (!food && sel.db) {
      setBusy(true);
      try {
        adopted = await adoptFood(sel.db.db, nutri.foods);
        food = adopted;
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Couldn't save that food.");
        return;
      }
    }
    if (!food) return;
    await log([{ ...base, kind: "food", food_id: food.id, recipe_id: null, name: food.brand ? `${food.name} (${food.brand})` : food.name, amount, unit, ...macrosFor(food, amount, unit) }], adopted);
  }

  async function toggleFav(id: string, kind: "food" | "recipe", on: boolean) {
    setNutri((n) => (kind === "food" ? { ...n, foods: n.foods.map((f) => (f.id === id ? { ...f, favorite: on } : f)) } : { ...n, recipes: n.recipes.map((r) => (r.id === id ? { ...r, favorite: on } : r)) }));
    try { await (kind === "food" ? setFoodFlags(id, { favorite: on }) : setRecipeFavorite(id, on)); } catch { /* shows next refresh */ }
  }

  return (
    <div className="food-add">
      <div className="editor-bar">
        <div>
          <h1>Add food</h1>
          <p className="muted small">To {MEALS[meal].toLowerCase()}, {dayName(day)}</p>
        </div>
        <button className="btn ghost" onClick={onDone}>Done</button>
      </div>

      <div className="seg meal-seg" role="group" aria-label="Meal">
        {MEALS.map((m, i) => (
          <button key={m} className={meal === i ? "on" : ""} aria-pressed={meal === i} onClick={() => setMeal(i as MealIndex)}>{m}</button>
        ))}
      </div>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      {sel ? (
        <AmountPanel
          key={sel.item.type === "recipe" ? sel.item.recipe.id : sel.item.id ?? sel.db?.db.ref}
          item={sel.item}
          nutri={nutri}
          busy={busy}
          actionLabel={`Add to ${MEALS[meal].toLowerCase()}`}
          onAdd={(a, u) => addSelected(a, u)}
          onBack={() => setSel(null)}
          onEdit={sel.item.type === "recipe" ? () => onEditRecipe((sel.item as { recipe: Recipe }).recipe) : sel.item.id ? () => onEditFood(nutri.foods.find((f) => f.id === (sel.item as { id: string }).id)!) : undefined}
        />
      ) : quick ? (
        <QuickAdd busy={busy} onCancel={() => setQuick(false)} onAdd={(name, m) => log([{ ...base, kind: "quick", food_id: null, recipe_id: null, name, amount: 1, unit: "serving", ...m }])} />
      ) : (
        <>
          <div className="chip-row" style={{ marginTop: 12 }}>
            <button className="fchip" onClick={() => setQuick(true)}>Quick add calories</button>
            <button className="fchip" onClick={() => onNewFood(query.trim())}>New food from a label</button>
            <button className="fchip" onClick={onNewRecipe}>New recipe</button>
          </div>

          <div style={{ marginTop: 12 }}>
            <FoodSearch nutri={nutri} onPick={pick} query={query} setQuery={setQuery} autoFocus={desktop} />
          </div>

          {!query.trim() && (
            <>
              <div className="seg" role="group" aria-label="List" style={{ marginTop: 14 }}>
                {(["recent", "saved", "recipes"] as Tab[]).map((t) => (
                  <button key={t} className={tab === t ? "on" : ""} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "recent" ? "Recent" : t === "saved" ? "My foods" : "Recipes"}</button>
                ))}
              </div>

              {tab === "recent" && (recents.length === 0 ? (
                <div className="empty" style={{ marginTop: 10 }}>
                  <p>Foods you log show up here.</p>
                  <p className="muted small">Next time it's one tap: the + adds the same amount again.</p>
                </div>
              ) : (
                <div className="panel list-panel" style={{ marginTop: 10 }}>
                  {recents.map((r) => (
                    <div key={r.key} className="list-row rec-row">
                      <button className="rec-main" onClick={() => openRecent(r)}>
                        <strong>{r.name}</strong>
                        <span className="small muted" style={{ display: "block" }}>
                          {r.kind === "quick" ? "Quick add" : r.unit === "g" ? `${fmtG(r.amount)} g` : `${fmtG(r.amount)} serving${r.amount === 1 ? "" : "s"}`} · {fmtKcal(r.macros.kcal)} kcal · P {fmtG(r.macros.protein)}
                        </span>
                      </button>
                      <button className="add-btn" disabled={busy} onClick={() => readd(r)} aria-label={`Add ${r.name} again`}><PlusIcon /></button>
                    </div>
                  ))}
                </div>
              ))}

              {tab === "saved" && (saved.length === 0 ? (
                <div className="empty" style={{ marginTop: 10 }}>
                  <p>Foods you've used or created live here.</p>
                  <button className="btn" onClick={() => onNewFood("")}>New food from a label</button>
                </div>
              ) : (
                <div className="panel list-panel" style={{ marginTop: 10 }}>
                  {saved.map((f) => (
                    <div key={f.id} className="list-row rec-row">
                      <button className="rec-main" onClick={() => setSel({ item: { type: "food", food: f, id: f.id } })}>
                        <strong>{f.name}</strong>{f.brand && <span className="muted"> · {f.brand}</span>}
                        <span className="small muted" style={{ display: "block" }}>
                          {f.serving_g ? `${fmtKcal((f.kcal * f.serving_g) / 100)} kcal per ${f.serving_label || `${f.serving_g} g`}` : `${fmtKcal(f.kcal)} kcal per 100 g`}
                        </span>
                      </button>
                      <button className={`star-btn${f.favorite ? " on" : ""}`} aria-pressed={f.favorite} aria-label={f.favorite ? "Unstar" : "Star"} onClick={() => toggleFav(f.id, "food", !f.favorite)}><Star on={f.favorite} /></button>
                    </div>
                  ))}
                </div>
              ))}

              {tab === "recipes" && (recipes.length === 0 ? (
                <div className="empty" style={{ marginTop: 10 }}>
                  <p>Save meals you make often, like your porridge or a batch of chilli, and log them in one go.</p>
                  <button className="btn" onClick={onNewRecipe}>New recipe</button>
                </div>
              ) : (
                <div className="panel list-panel" style={{ marginTop: 10 }}>
                  {recipes.map((r) => {
                    const ps = perServing(r, nutri.foods);
                    return (
                      <div key={r.id} className="list-row rec-row">
                        <button className="rec-main" onClick={() => setSel({ item: { type: "recipe", recipe: r } })}>
                          <strong>{r.name}</strong>
                          <span className="small muted" style={{ display: "block" }}>{fmtKcal(ps.kcal)} kcal · P {fmtG(ps.protein)} per serving{r.servings !== 1 ? ` (makes ${fmtG(r.servings)})` : ""}</span>
                        </button>
                        <button className={`star-btn${r.favorite ? " on" : ""}`} aria-pressed={r.favorite} aria-label={r.favorite ? "Unstar" : "Star"} onClick={() => toggleFav(r.id, "recipe", !r.favorite)}><Star on={r.favorite} /></button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function QuickAdd({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (name: string, m: { kcal: number; protein: number; carbs: number; fat: number }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [v, setV] = useState({ kcal: "", protein: "", carbs: "", fat: "" });
  const kcal = num(v.kcal);
  const p = num(v.protein) ?? 0, c = num(v.carbs) ?? 0, f = num(v.fat) ?? 0;
  // Calories from the macros if those are filled and calories aren't
  const fromMacros = p * 4 + c * 4 + f * 9;
  const k = kcal ?? (fromMacros > 0 ? fromMacros : null);
  return (
    <section className="panel amount-panel">
      <button className="link small" onClick={onCancel}>‹ Back</button>
      <h2 style={{ marginTop: 8 }}>Quick add</h2>
      <p className="muted small">For a meal out or anything you don't want to look up.</p>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Name (optional)</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken wrap from the canteen" />
      </label>
      <div className="grid c4" style={{ marginTop: 10 }}>
        {(["kcal", "protein", "carbs", "fat"] as const).map((key) => (
          <label className="field" key={key}>
            <span>{key === "kcal" ? "Calories" : `${key[0].toUpperCase()}${key.slice(1)} (g)`}</span>
            <input className="input" inputMode="decimal" value={v[key]} placeholder={key === "kcal" && fromMacros > 0 ? String(Math.round(fromMacros)) : ""} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      {k != null && <p className="small" style={{ marginTop: 10 }}><MacroLine m={roundMacros({ kcal: k, protein: p, carbs: c, fat: f })} /></p>}
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={k == null || k <= 0 || busy} onClick={() => k != null && onAdd(name.trim() || "Quick add", { kcal: k, protein: p, carbs: c, fat: f })}>
        {busy ? "Adding…" : "Add"}
      </button>
    </section>
  );
}
