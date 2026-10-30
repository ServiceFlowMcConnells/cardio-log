import { useEffect, useMemo, useState } from "react";
import type { DbFood, Food, Macros, NewEntry, NutritionData, Recipe, RecentItem } from "../../lib/nutrition";
import { addEntries, adoptFood, fromYmd, isTime, hourTime, macrosFor, nowHour, perServing, recentItems, scaleMacros, setFoodFlags, setRecipeFavorite, sumMacros, targetFor, todayYmd } from "../../lib/nutrition";
import { useDesktop } from "../../lib/desktop";
import FoodSearch, { type Picked } from "./FoodSearch";
import AmountPanel, { defaultAmount, type Loggable } from "./AmountPanel";
import { HourPicker, MacroInputs, MacroLine, MacroSub, PlusIcon, Star, fmtG, fmtKcal, formKcal, macroForm, num, type MacroForm } from "./bits";

type Tab = "recent" | "saved" | "recipes";

/** One thing on the plate. Foods keep a reference so the numbers follow the food; quick adds are fixed. */
type PlateItem = {
  key: string;
  kind: "food" | "recipe" | "quick";
  name: string;
  amount: string;
  unit: "g" | "serving";
  foodId?: string;
  db?: DbFood; // a database food not in your foods yet (saved when you log the plate)
  recipeId?: string;
  quick?: Macros;
};

type Draft = { day: string; time: string; items: PlateItem[] };
// The plate survives a trip to "New food" or "New recipe" and back (cleared once logged or cancelled)
let saved: Draft | null = null;
let seq = 0;

interface Props {
  nutri: NutritionData;
  day: string;
  time?: string;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onDone: () => void;
  onNewFood: (name: string, barcode?: string) => void;
  onEditFood: (f: Food) => void;
  onNewRecipe: () => void;
  onEditRecipe: (r: Recipe) => void;
  preselect?: string | null; // a food id just created
}

const dayName = (d: string) => (d === todayYmd() ? "Today" : fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" }));

export default function FoodAdd({ nutri, day, time: time0, setNutri, onDone, onNewFood, onEditFood, onNewRecipe, onEditRecipe, preselect }: Props) {
  const desktop = useDesktop();
  const resume = saved && saved.day === day ? saved : null;
  const [time, setTime] = useState(hourTime(Number((resume?.time ?? time0 ?? (day === todayYmd() ? nowHour() : "12:00")).slice(0, 2))));
  const [items, setItems] = useState<PlateItem[]>(resume?.items ?? []);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const [sel, setSel] = useState<{ item: Loggable; db?: DbFood } | null>(null);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { saved = { day, time, items }; }, [day, time, items]);

  useEffect(() => {
    if (!preselect) return;
    const f = nutri.foods.find((x) => x.id === preselect);
    if (f) setSel({ item: { type: "food", food: f, id: f.id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  const foodsById = useMemo(() => new Map(nutri.foods.map((f) => [f.id, f])), [nutri.foods]);
  const recipesById = useMemo(() => new Map(nutri.recipes.map((r) => [r.id, r])), [nutri.recipes]);
  const recents = useMemo(() => recentItems(nutri.log, nutri.foods, nutri.recipes), [nutri]);
  const myFoods = useMemo(() => nutri.foods.filter((f) => !f.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)), [nutri.foods]);
  const recipes = useMemo(() => [...nutri.recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)), [nutri.recipes]);

  const macrosOfItem = (it: PlateItem): Macros | null => {
    const a = num(it.amount);
    if (it.kind === "quick") return it.quick ?? null;
    if (a == null || a <= 0) return null;
    if (it.kind === "recipe") { const r = it.recipeId ? recipesById.get(it.recipeId) : undefined; return r ? scaleMacros(perServing(r, nutri.foods), a) : null; }
    const f = (it.foodId && foodsById.get(it.foodId)) || it.db;
    return f ? macrosFor(f, a, it.unit) : null;
  };
  const plateMacros = sumMacros(items.map(macrosOfItem).filter((m): m is Macros => m != null));
  const dayMacros = sumMacros(nutri.log.filter((e) => e.eaten_on === day));
  const target = targetFor(nutri.targets, day);
  const allValid = items.length > 0 && items.every((it) => macrosOfItem(it) != null);

  const push = (it: Omit<PlateItem, "key">) => {
    setItems((xs) => [...xs, { ...it, key: `p${++seq}` }]);
    setSel(null);
    setQuick(false);
    setQuery("");
  };

  const pushFood = (f: Food, amount?: number, unit?: "g" | "serving") => {
    const d = amount != null && unit ? { amount, unit } : defaultAmount({ type: "food", food: f, id: f.id }, nutri);
    push({ kind: "food", name: f.brand ? `${f.name} (${f.brand})` : f.name, amount: String(d.amount), unit: d.unit, foodId: f.id });
  };
  const pushRecipe = (r: Recipe, amount?: number) => {
    push({ kind: "recipe", name: r.name, amount: String(amount ?? defaultAmount({ type: "recipe", recipe: r }, nutri).amount), unit: "serving", recipeId: r.id });
  };

  function pushRecent(r: RecentItem) {
    if (r.kind === "food") { const f = r.id ? foodsById.get(r.id) : undefined; if (f) pushFood(f, r.amount, r.unit); }
    else if (r.kind === "recipe") { const rec = r.id ? recipesById.get(r.id) : undefined; if (rec) pushRecipe(rec, r.amount); }
    else push({ kind: "quick", name: r.name, amount: "1", unit: "serving", quick: r.macros });
  }
  function openRecent(r: RecentItem) {
    if (r.kind === "food") { const f = r.id ? foodsById.get(r.id) : undefined; if (f) setSel({ item: { type: "food", food: f, id: f.id } }); }
    else if (r.kind === "recipe") { const rec = r.id ? recipesById.get(r.id) : undefined; if (rec) setSel({ item: { type: "recipe", recipe: rec } }); }
    else pushRecent(r);
  }
  function pick(p: Picked) {
    if (p.type === "food") setSel({ item: { type: "food", food: p.food, id: p.food.id } });
    else if (p.type === "recipe") setSel({ item: { type: "recipe", recipe: p.recipe } });
    else {
      const mine = nutri.foods.find((f) => f.source === p.db.source && f.source_ref === p.db.ref);
      setSel(mine ? { item: { type: "food", food: mine, id: mine.id } } : { item: { type: "food", food: p.db, id: null, note: p.db.source === "cofid" ? "McCance & Widdowson (CoFID 2021)" : "Open Food Facts" }, db: p.db });
    }
  }
  function addSelected(amount: number, unit: "g" | "serving") {
    if (!sel) return;
    const it = sel.item;
    if (it.type === "recipe") return pushRecipe(it.recipe, amount);
    if (it.id) { const f = foodsById.get(it.id); if (f) return pushFood(f, amount, unit); }
    if (sel.db) push({ kind: "food", name: sel.db.brand ? `${sel.db.name} (${sel.db.brand})` : sel.db.name, amount: String(amount), unit, db: sel.db });
  }

  async function logPlate() {
    if (!allValid || !isTime(time)) return;
    setBusy(true);
    setError(null);
    try {
      let foods = nutri.foods;
      const adopted: Food[] = [];
      const entries: NewEntry[] = [];
      for (const it of items) {
        const a = num(it.amount) ?? 1;
        const base = { eaten_on: day, eaten_time: time, name: it.name, amount: it.kind === "quick" ? 1 : a, unit: it.kind === "quick" ? ("serving" as const) : it.unit };
        if (it.kind === "quick") { entries.push({ ...base, kind: "quick", food_id: null, recipe_id: null, ...it.quick! }); continue; }
        if (it.kind === "recipe") { entries.push({ ...base, kind: "recipe", food_id: null, recipe_id: it.recipeId!, ...macrosOfItem(it)! }); continue; }
        let f = it.foodId ? foods.find((x) => x.id === it.foodId) : undefined;
        if (!f && it.db) {
          f = await adoptFood(it.db, foods);
          adopted.push(f);
          foods = [...foods.filter((x) => x.id !== f!.id), f];
        }
        if (!f) continue;
        entries.push({ ...base, kind: "food", food_id: f.id, recipe_id: null, ...macrosFor(f, a, it.unit) });
      }
      const added = await addEntries(entries);
      setNutri((n) => ({ ...n, foods: [...n.foods.filter((x) => !adopted.some((y) => y.id === x.id)), ...adopted], log: [...n.log, ...added] }));
      saved = null;
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that.");
      setBusy(false);
    }
  }

  const cancel = () => { saved = null; onDone(); };
  const total = { kcal: dayMacros.kcal + plateMacros.kcal, protein: dayMacros.protein + plateMacros.protein, carbs: dayMacros.carbs + plateMacros.carbs, fat: dayMacros.fat + plateMacros.fat };

  const plate = (
    <section className="panel plate">
      <div className="plate-top">
        <HourPicker value={time} onChange={setTime} />
        <div className="chip-row time-quick">
          {day === todayYmd() && <button className={`fchip${time === nowHour() ? " on" : ""}`} onClick={() => setTime(nowHour())}>Now</button>}
          {["08:00", "13:00", "16:00", "19:00"].map((t) => <button key={t} className={`fchip${time === t ? " on" : ""}`} onClick={() => setTime(t)}>{t}</button>)}
        </div>
      </div>
      <div className="plate-bars" aria-label="Day so far including this plate">
        <MiniBar label="kcal" v={total.kcal} t={target?.kcal ?? null} cls="k" />
        <MiniBar label="P" v={total.protein} t={target?.protein ?? null} cls="p" />
        <MiniBar label="F" v={total.fat} t={target?.fat ?? null} cls="f" />
        <MiniBar label="C" v={total.carbs} t={target?.carbs ?? null} cls="c" />
      </div>

      <h2 className="plate-h">Your plate <span className="muted small">{dayName(day)} at {time}</span></h2>
      {items.length === 0 ? (
        <p className="muted small">Add foods below; they collect here until you log them together.</p>
      ) : (
        <>
          <div className="plate-list">
            {items.map((it) => {
              const m = macrosOfItem(it);
              const f = it.foodId ? foodsById.get(it.foodId) : it.db;
              return (
                <div key={it.key} className="plate-row">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="entry-name">{it.name}</span>
                    <span className="small muted" style={{ display: "block" }}>{m ? <MacroSub m={m} /> : "Enter an amount"}</span>
                  </span>
                  {it.kind !== "quick" && (
                    <span className="plate-amt">
                      <input className="cell" inputMode="decimal" value={it.amount} aria-label={`Amount of ${it.name}`} onFocus={(e) => e.target.select()} onChange={(e) => setItems(items.map((x) => (x.key === it.key ? { ...x, amount: e.target.value } : x)))} />
                      {it.kind === "food" && f?.serving_g ? (
                        <button className="unit-tog" onClick={() => setItems(items.map((x) => {
                          if (x.key !== it.key) return x;
                          const a = num(x.amount);
                          const u = x.unit === "g" ? "serving" : "g";
                          return { ...x, unit: u, amount: a == null ? x.amount : String(u === "g" ? Math.round(a * f.serving_g!) : Math.round((a / f.serving_g!) * 100) / 100) };
                        }))}>{it.unit === "g" ? "g" : "srv"}</button>
                      ) : <span className="small muted unit-lbl">{it.unit === "g" ? "g" : "srv"}</span>}
                    </span>
                  )}
                  <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={() => setItems(items.filter((x) => x.key !== it.key))}>✕</button>
                </div>
              );
            })}
          </div>
          <div className="plate-total"><MacroLine m={plateMacros} /></div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="plate-actions">
        <button className="btn ghost" onClick={cancel}>{items.length ? "Discard" : "Close"}</button>
        <button className="btn primary plate-log" style={{ flex: 1 }} disabled={!allValid || busy || !isTime(time)} onClick={logPlate}>
          {busy ? "Logging…" : items.length ? `Log ${items.length} food${items.length === 1 ? "" : "s"} · ${fmtKcal(plateMacros.kcal)} kcal` : "Log foods"}
        </button>
      </div>
    </section>
  );

  const picker = sel ? (
    <AmountPanel
      key={sel.item.type === "recipe" ? sel.item.recipe.id : sel.item.id ?? sel.db?.ref}
      item={sel.item}
      nutri={nutri}
      actionLabel="Add to plate"
      onAdd={(a, u) => addSelected(a, u)}
      onBack={() => setSel(null)}
      onEdit={sel.item.type === "recipe" ? () => onEditRecipe((sel.item as { recipe: Recipe }).recipe) : sel.item.id ? () => onEditFood(foodsById.get((sel.item as { id: string }).id)!) : undefined}
    />
  ) : quick ? (
    <QuickAdd onCancel={() => setQuick(false)} onAdd={(name, m) => push({ kind: "quick", name, amount: "1", unit: "serving", quick: m })} />
  ) : (
    <>
      <div className="chip-row">
        <button className="fchip" onClick={() => setQuick(true)}>Quick add</button>
        <button className="fchip" onClick={() => onNewFood(query.trim())}>New food from a label</button>
        <button className="fchip" onClick={onNewRecipe}>New recipe</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <FoodSearch nutri={nutri} onPick={pick} query={query} setQuery={setQuery} autoFocus={desktop} onNewFood={onNewFood} />
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
              <p className="muted small">Next time the + puts the same amount on your plate in one tap.</p>
            </div>
          ) : (
            <div className="panel list-panel" style={{ marginTop: 10 }}>
              {recents.map((r) => (
                <div key={r.key} className="list-row rec-row">
                  <button className="rec-main" onClick={() => openRecent(r)}>
                    <strong>{r.name}</strong>
                    <span className="small muted" style={{ display: "block" }}><MacroSub m={r.macros} amount={r.kind === "quick" ? "quick add" : r.unit === "g" ? `${fmtG(r.amount)} g` : `${fmtG(r.amount)} serving${r.amount === 1 ? "" : "s"}`} /></span>
                  </button>
                  <button className="add-btn" onClick={() => pushRecent(r)} aria-label={`Add ${r.name} to the plate`}><PlusIcon /></button>
                </div>
              ))}
            </div>
          ))}
          {tab === "saved" && (myFoods.length === 0 ? (
            <div className="empty" style={{ marginTop: 10 }}>
              <p>Foods you've used or created live here.</p>
              <button className="btn" onClick={() => onNewFood("")}>New food from a label</button>
            </div>
          ) : (
            <div className="panel list-panel" style={{ marginTop: 10 }}>
              {myFoods.map((f) => (
                <div key={f.id} className="list-row rec-row">
                  <button className="rec-main" onClick={() => setSel({ item: { type: "food", food: f, id: f.id } })}>
                    <strong>{f.name}</strong>{f.brand && <span className="muted"> · {f.brand}</span>}
                    <span className="small muted" style={{ display: "block" }}>{f.serving_g ? `${fmtKcal((f.kcal * f.serving_g) / 100)} kcal per ${f.serving_label || `${f.serving_g} g`}` : `${fmtKcal(f.kcal)} kcal per 100 g`}</span>
                  </button>
                  <button className={`star-btn${f.favorite ? " on" : ""}`} aria-pressed={f.favorite} aria-label={f.favorite ? "Unstar" : "Star"} onClick={() => toggleFav(f.id, "food", !f.favorite)}><Star on={f.favorite} /></button>
                  <button className="add-btn" onClick={() => pushFood(f)} aria-label={`Add ${f.name} to the plate`}><PlusIcon /></button>
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
                    <button className="add-btn" onClick={() => pushRecipe(r)} aria-label={`Add ${r.name} to the plate`}><PlusIcon /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </>
  );

  async function toggleFav(id: string, kind: "food" | "recipe", on: boolean) {
    setNutri((n) => (kind === "food" ? { ...n, foods: n.foods.map((f) => (f.id === id ? { ...f, favorite: on } : f)) } : { ...n, recipes: n.recipes.map((r) => (r.id === id ? { ...r, favorite: on } : r)) }));
    try { await (kind === "food" ? setFoodFlags(id, { favorite: on }) : setRecipeFavorite(id, on)); } catch { /* shows next refresh */ }
  }

  return (
    <div className="food-add">
      <div className="editor-bar">
        <div>
          <h1>Log food</h1>
          <p className="muted small">{dayName(day)}</p>
        </div>
      </div>
      <div className="cols plate-cols">
        <div className="col plate-col">{plate}</div>
        <div className="col">{picker}</div>
      </div>
      {items.length > 0 && !desktop && (
        <div className="save-bar plate-float">
          <button className="btn primary block" disabled={!allValid || busy || !isTime(time)} onClick={logPlate}>
            {busy ? "Logging…" : `Log ${items.length} food${items.length === 1 ? "" : "s"} at ${time} · ${fmtKcal(plateMacros.kcal)} kcal`}
          </button>
        </div>
      )}
    </div>
  );
}

function MiniBar({ label, v, t, cls }: { label: string; v: number; t: number | null; cls: string }) {
  const over = t != null && v > t * 1.05;
  return (
    <div className="mini">
      <span className="small num"><strong>{cls === "k" ? fmtKcal(v) : Math.round(v)}</strong>{t != null && <span className="muted"> / {cls === "k" ? fmtKcal(t) : t}</span>} {label}</span>
      <div className="tbar-track"><div className={`tbar-fill ${cls}${over ? " over" : ""}`} style={{ width: `${t ? Math.min(100, (v / t) * 100) : 0}%` }} /></div>
    </div>
  );
}

function QuickAdd({ onAdd, onCancel }: { onAdd: (name: string, m: Macros) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [v, setV] = useState<MacroForm>(() => macroForm(null));
  const k = formKcal(v);
  const p = num(v.protein) ?? 0, c = num(v.carbs) ?? 0, f = num(v.fat) ?? 0;
  return (
    <section className="panel amount-panel">
      <button className="link small" onClick={onCancel}>‹ Back</button>
      <h2 style={{ marginTop: 8 }}>Quick add</h2>
      <p className="muted small">For a meal out or anything you don't want to look up.</p>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Name (optional)</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken wrap from the canteen" />
      </label>
      <div style={{ marginTop: 10 }}><MacroInputs v={v} set={setV} /></div>
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={k == null || k <= 0} onClick={() => k != null && onAdd(name.trim() || "Quick add", { kcal: k, protein: p, carbs: c, fat: f })}>
        {k != null && k > 0 ? `Add ${fmtKcal(k)} kcal to plate` : "Add to plate"}
      </button>
    </section>
  );
}
