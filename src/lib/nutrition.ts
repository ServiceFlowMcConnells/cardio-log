// Nutrition: foods, recipes, the daily log, coach targets and bodyweight trend.
// Food values are per 100 g (or 100 ml). Log entries store their own totals, so editing or
// deleting a food later never rewrites what you've already logged.
import { supabase } from "./supabase";

export interface Macros { kcal: number; protein: number; carbs: number; fat: number }

export interface Food extends Macros {
  id: string;
  name: string;
  brand: string | null;
  source: "custom" | "cofid" | "off";
  source_ref: string | null;
  barcode: string | null;
  fibre: number | null;
  serving_g: number | null;
  serving_label: string | null;
  favorite: boolean;
  archived: boolean;
}

export interface RecipeItem { id?: string; food_id: string; grams: number; position: number }
export interface Recipe { id: string; name: string; servings: number; notes: string | null; favorite: boolean; items: RecipeItem[] }

export type MealIndex = 0 | 1 | 2 | 3;
export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"] as const;

export interface LogEntry extends Macros {
  id: string;
  eaten_on: string; // YYYY-MM-DD
  eaten_time: string; // HH:MM
  meal: MealIndex; // derived from the time (kept for older screens)
  kind: "food" | "recipe" | "quick";
  food_id: string | null;
  recipe_id: string | null;
  name: string;
  amount: number;
  unit: "g" | "serving";
  created_at: string;
}

export interface Target { id: string; effective_from: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null }
export interface BodyWeight { id: string; measured_on: string; weight_kg: number }

/** A reference food from the database or Open Food Facts, not yet in your foods. */
export interface DbFood extends Macros { ref: string; source: "cofid" | "off"; name: string; brand: string | null; fibre: number | null; serving_g: number | null; serving_label: string | null; barcode: string | null }

export interface NutritionData { foods: Food[]; recipes: Recipe[]; log: LogEntry[]; targets: Target[]; weights: BodyWeight[] }
export const EMPTY_NUTRITION: NutritionData = { foods: [], recipes: [], log: [], targets: [], weights: [] };

// ---------- dates ----------
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const todayYmd = () => ymd(new Date());

/** Breakfast before 11, lunch before 3, dinner before 9, else snacks. */
export function mealForNow(d = new Date()): MealIndex {
  const h = d.getHours();
  return h < 11 ? 0 : h < 15 ? 1 : h < 21 ? 2 : 3;
}
export function mealForTime(t: string): MealIndex {
  const h = Number(t.slice(0, 2));
  return h < 11 ? 0 : h < 15 ? 1 : h < 21 ? 2 : 3;
}
const pad = (n: number) => String(n).padStart(2, "0");
/** Food is logged to the hour, like MacroFactor: "20:00". */
export const hourTime = (h: number) => `${pad(Math.max(0, Math.min(23, h)))}:00`;
export const nowHour = (d = new Date()) => hourTime(d.getHours());
export const hourOf = (t: string) => Number(t.slice(0, 2));
export const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// ---------- maths ----------
const r1 = (n: number) => Math.round(n * 10) / 10;
export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
export const addMacros = (a: Macros, b: Macros): Macros => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat });
export const scaleMacros = (m: Macros, f: number): Macros => ({ kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f });
export const sumMacros = (xs: Macros[]) => xs.reduce(addMacros, ZERO);
export const roundMacros = (m: Macros): Macros => ({ kcal: Math.round(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) });

export function gramsOf(food: Pick<Food, "serving_g">, amount: number, unit: "g" | "serving"): number {
  return unit === "serving" && food.serving_g ? amount * food.serving_g : amount;
}
export function macrosFor(food: Macros & Pick<Food, "serving_g">, amount: number, unit: "g" | "serving"): Macros {
  return scaleMacros(food, gramsOf(food, amount, unit) / 100);
}

/** Whole-recipe totals and grams (foods missing from the list are skipped). */
export function recipeTotals(r: Pick<Recipe, "items">, foods: Food[]): Macros & { grams: number } {
  const byId = new Map(foods.map((f) => [f.id, f]));
  let m = ZERO, grams = 0;
  for (const it of r.items) {
    const f = byId.get(it.food_id);
    if (!f) continue;
    m = addMacros(m, scaleMacros(f, it.grams / 100));
    grams += it.grams;
  }
  return { ...m, grams };
}
export const perServing = (r: Recipe, foods: Food[]): Macros => scaleMacros(recipeTotals(r, foods), 1 / r.servings);

/** The coach target in force on a day (latest effective_from on or before it). */
export function targetFor(targets: Target[], day: string): Target | null {
  let best: Target | null = null;
  for (const t of targets) if (t.effective_from <= day && (!best || t.effective_from > best.effective_from)) best = t;
  return best;
}

/** Protein/carbs/fat calories, for a target's macro split. */
export const macroKcal = (p: number, c: number, f: number) => p * 4 + c * 4 + f * 9;

export interface RecentItem { key: string; kind: "food" | "recipe" | "quick"; id: string | null; name: string; amount: number; unit: "g" | "serving"; macros: Macros; lastUsed: string; uses: number }

/** Foods and recipes you've logged, most recent first, with the amount you used last time.
 *  Quick adds repeat by name and calories. */
export function recentItems(log: LogEntry[], foods: Food[], recipes: Recipe[], limit = 40): RecentItem[] {
  const foodIds = new Set(foods.filter((f) => !f.archived).map((f) => f.id));
  const recipeIds = new Set(recipes.map((r) => r.id));
  const seen = new Map<string, RecentItem>();
  const sorted = [...log].sort((a, b) => (b.eaten_on + b.eaten_time + b.created_at).localeCompare(a.eaten_on + a.eaten_time + a.created_at));
  for (const e of sorted) {
    let key: string | null = null;
    if (e.kind === "food" && e.food_id && foodIds.has(e.food_id)) key = "f:" + e.food_id;
    else if (e.kind === "recipe" && e.recipe_id && recipeIds.has(e.recipe_id)) key = "r:" + e.recipe_id;
    else if (e.kind === "quick") key = `q:${e.name.toLowerCase()}:${Math.round(e.kcal)}`;
    if (!key) continue;
    const had = seen.get(key);
    if (had) { had.uses++; continue; }
    seen.set(key, { key, kind: e.kind, id: e.kind === "food" ? e.food_id : e.kind === "recipe" ? e.recipe_id : null, name: e.name, amount: e.amount, unit: e.unit, macros: { kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }, lastUsed: e.eaten_on, uses: 1 });
  }
  return [...seen.values()].slice(0, limit);
}

/** Simple word-prefix search score: every query word must start a word in the name. Higher is better. */
export function matchScore(name: string, q: string): number {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return 0;
  const n = name.toLowerCase();
  const nw = n.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    const i = nw.findIndex((x) => x.startsWith(w));
    if (i < 0) return -1;
    score += i === 0 ? 3 : 1;
    if (nw[i] === w) score += 1;
  }
  return score - nw.length * 0.05; // shorter names (plain foods) first
}

// ---------- bodyweight trend ----------
export interface TrendPoint { day: string; scale: number | null; trend: number }

/** Exponentially smoothed trend weight (10% of each day's difference, as in The Hacker's Diet and similar
 *  to MacroFactor). Days without a weigh-in use a straight line between the weigh-ins either side, and
 *  after your last weigh-in the trend holds. */
export function trendWeights(weights: BodyWeight[], until = todayYmd(), alpha = 0.1): TrendPoint[] {
  const ws = [...weights].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  if (!ws.length) return [];
  const out: TrendPoint[] = [];
  let trend = ws[0].weight_kg;
  let i = 0;
  const last = ws[ws.length - 1].measured_on > until ? ws[ws.length - 1].measured_on : until;
  for (let day = ws[0].measured_on; day <= last; day = addDays(day, 1)) {
    while (i < ws.length - 1 && ws[i + 1].measured_on <= day) i++;
    const cur = ws[i];
    let input: number | null;
    let scale: number | null = null;
    if (cur.measured_on === day) { input = cur.weight_kg; scale = cur.weight_kg; }
    else if (i < ws.length - 1) {
      const nxt = ws[i + 1];
      const span = (fromYmd(nxt.measured_on).getTime() - fromYmd(cur.measured_on).getTime()) / 86400000;
      const k = (fromYmd(day).getTime() - fromYmd(cur.measured_on).getTime()) / 86400000 / span;
      input = cur.weight_kg + (nxt.weight_kg - cur.weight_kg) * k;
    } else input = null; // past the last weigh-in: hold
    if (input != null && day !== ws[0].measured_on) trend = trend + alpha * (input - trend);
    out.push({ day, scale, trend });
  }
  return out;
}

/** Trend change per week over the last `days` (default 14), as kg and % of bodyweight. */
export function weeklyRate(points: TrendPoint[], days = 14): { kg: number; pct: number; over: number } | null {
  if (points.length < 8) return null;
  const end = points[points.length - 1];
  const span = Math.min(days, points.length - 1);
  const start = points[points.length - 1 - span];
  const kg = ((end.trend - start.trend) / span) * 7;
  return { kg, pct: (kg / end.trend) * 100, over: span };
}

// ---------- data ----------
type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const nn = (v: unknown) => (v == null ? null : Number(v));

const FOOD_COLS = "id, name, brand, source, source_ref, barcode, kcal, protein, carbs, fat, fibre, serving_g, serving_label, favorite, archived";
const toFood = (r: Row): Food => ({
  id: r.id as string, name: r.name as string, brand: (r.brand as string) ?? null, source: r.source as Food["source"], source_ref: (r.source_ref as string) ?? null,
  barcode: (r.barcode as string) ?? null, kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat), fibre: nn(r.fibre),
  serving_g: nn(r.serving_g), serving_label: (r.serving_label as string) ?? null, favorite: Boolean(r.favorite), archived: Boolean(r.archived),
});
const toEntry = (r: Row): LogEntry => ({
  id: r.id as string, eaten_on: r.eaten_on as string, eaten_time: String(r.eaten_time ?? "12:00").slice(0, 5), meal: n(r.meal) as MealIndex, kind: r.kind as LogEntry["kind"], food_id: (r.food_id as string) ?? null,
  recipe_id: (r.recipe_id as string) ?? null, name: r.name as string, amount: n(r.amount), unit: r.unit as LogEntry["unit"],
  kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat), created_at: r.created_at as string,
});

export async function loadNutrition(days = 180): Promise<NutritionData> {
  const since = addDays(todayYmd(), -days);
  const [f, r, l, t, w] = await Promise.all([
    supabase.from("foods").select(FOOD_COLS).order("name"),
    supabase.from("recipes").select("id, name, servings, notes, favorite, recipe_items(id, food_id, grams, position)").order("name"),
    supabase.from("food_log").select("*").gte("eaten_on", since).order("eaten_on").order("eaten_time").order("created_at"),
    supabase.from("nutrition_targets").select("id, effective_from, kcal, protein, carbs, fat").order("effective_from"),
    supabase.from("body_weights").select("id, measured_on, weight_kg").order("measured_on"),
  ]);
  for (const x of [f, r, l, t, w]) if (x.error) throw x.error;
  return {
    foods: (f.data ?? []).map(toFood),
    recipes: (r.data ?? []).map((x: Row) => ({
      id: x.id as string, name: x.name as string, servings: n(x.servings) || 1, notes: (x.notes as string) ?? null, favorite: Boolean(x.favorite),
      items: ((x.recipe_items as Row[]) ?? []).map((i) => ({ id: i.id as string, food_id: i.food_id as string, grams: n(i.grams), position: n(i.position) })).sort((a, b) => a.position - b.position),
    })),
    log: (l.data ?? []).map(toEntry),
    targets: (t.data ?? []).map((x: Row) => ({ id: x.id as string, effective_from: x.effective_from as string, kcal: n(x.kcal), protein: nn(x.protein), carbs: nn(x.carbs), fat: nn(x.fat) })),
    weights: (w.data ?? []).map((x: Row) => ({ id: x.id as string, measured_on: x.measured_on as string, weight_kg: n(x.weight_kg) })),
  };
}

export type NewEntry = Omit<LogEntry, "id" | "created_at" | "meal">;
const entryRow = (e: NewEntry) => {
  const m = roundMacros(e);
  return { eaten_on: e.eaten_on, eaten_time: e.eaten_time, meal: mealForTime(e.eaten_time), kind: e.kind, food_id: e.food_id, recipe_id: e.recipe_id, name: e.name.trim() || "Quick add", amount: e.amount, unit: e.unit, ...m };
};

export async function addEntries(es: NewEntry[]): Promise<LogEntry[]> {
  if (!es.length) return [];
  const { data, error } = await supabase.from("food_log").insert(es.map(entryRow)).select("*");
  if (error) throw error;
  return (data ?? []).map(toEntry);
}
export async function updateEntry(id: string, e: NewEntry): Promise<LogEntry> {
  const { data, error } = await supabase.from("food_log").update(entryRow(e)).eq("id", id).select("*").single();
  if (error) throw error;
  return toEntry(data);
}
/** Move entries to another day and hour. */
export async function moveEntries(ids: string[], day: string, time: string): Promise<LogEntry[]> {
  const { data, error } = await supabase.from("food_log").update({ eaten_on: day, eaten_time: time, meal: mealForTime(time) }).in("id", ids).select("*");
  if (error) throw error;
  return (data ?? []).map(toEntry);
}
export async function deleteEntries(ids: string[]): Promise<void> {
  const { error } = await supabase.from("food_log").delete().in("id", ids);
  if (error) throw error;
}
/** Copies of entries at another day and hour. */
export const copyOf = (e: LogEntry, day: string, time: string): NewEntry => ({ eaten_on: day, eaten_time: time, kind: e.kind, food_id: e.food_id, recipe_id: e.recipe_id, name: e.name, amount: e.amount, unit: e.unit, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat });

/** Logged foods (and recipes, broken into their ingredients) as recipe ingredients in grams. Quick adds can't be. */
export function ingredientsFrom(entries: LogEntry[], foods: Food[], recipes: Recipe[]): { items: { food_id: string; grams: number }[]; skipped: number } {
  const fs = new Map(foods.map((f) => [f.id, f]));
  const rs = new Map(recipes.map((r) => [r.id, r]));
  const items: { food_id: string; grams: number }[] = [];
  let skipped = 0;
  for (const e of entries) {
    const f = e.food_id ? fs.get(e.food_id) : undefined;
    const r = e.recipe_id ? rs.get(e.recipe_id) : undefined;
    if (e.kind === "food" && f) items.push({ food_id: f.id, grams: Math.round(gramsOf(f, e.amount, e.unit) * 10) / 10 });
    else if (e.kind === "recipe" && r) for (const it of r.items) items.push({ food_id: it.food_id, grams: Math.round(((it.grams * e.amount) / r.servings) * 10) / 10 });
    else skipped++;
  }
  // Same food twice: one line
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.food_id, (merged.get(it.food_id) ?? 0) + it.grams);
  return { items: [...merged].map(([food_id, grams]) => ({ food_id, grams })), skipped };
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from("food_log").delete().eq("id", id);
  if (error) throw error;
}

export type FoodInput = Omit<Food, "id" | "favorite" | "archived"> & { favorite?: boolean };
export async function saveFood(f: FoodInput, id?: string): Promise<Food> {
  const row = { name: f.name.trim(), brand: f.brand?.trim() || null, source: f.source, source_ref: f.source_ref, barcode: f.barcode, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fibre: f.fibre, serving_g: f.serving_g, serving_label: f.serving_label?.trim() || null, updated_at: new Date().toISOString(), ...(f.favorite != null ? { favorite: f.favorite } : {}) };
  const q = id ? supabase.from("foods").update(row).eq("id", id) : supabase.from("foods").insert(row);
  const { data, error } = await q.select(FOOD_COLS).single();
  if (error) throw error;
  return toFood(data);
}
export async function setFoodFlags(id: string, flags: { favorite?: boolean; archived?: boolean }): Promise<void> {
  const { error } = await supabase.from("foods").update({ ...flags, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Your copy of a database food: reuse it if you've used it before, otherwise save it. */
export async function adoptFood(d: DbFood, mine: Food[]): Promise<Food> {
  const had = mine.find((f) => f.source === d.source && f.source_ref === d.ref);
  if (had) {
    if (had.archived) await setFoodFlags(had.id, { archived: false });
    return { ...had, archived: false };
  }
  return saveFood({ name: d.name, brand: d.brand, source: d.source, source_ref: d.ref, barcode: d.barcode, kcal: d.kcal, protein: d.protein, carbs: d.carbs, fat: d.fat, fibre: d.fibre, serving_g: d.serving_g, serving_label: d.serving_label });
}

export async function saveRecipe(r: { id?: string; name: string; servings: number; notes: string | null; items: RecipeItem[] }): Promise<string> {
  const head = { name: r.name.trim(), servings: r.servings, notes: r.notes?.trim() || null, updated_at: new Date().toISOString() };
  let id = r.id;
  if (id) {
    const { error } = await supabase.from("recipes").update(head).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("recipes").insert(head).select("id").single();
    if (error) throw error;
    id = data.id as string;
  }
  const rid = id as string;
  const { data: old, error: oe } = await supabase.from("recipe_items").select("id").eq("recipe_id", rid);
  if (oe) throw oe;
  if (r.items.length) {
    const { error } = await supabase.from("recipe_items").insert(r.items.map((it, position) => ({ recipe_id: rid, food_id: it.food_id, grams: it.grams, position })));
    if (error) throw error;
  }
  const oldIds = (old ?? []).map((x) => x.id as string);
  if (oldIds.length) {
    const { error } = await supabase.from("recipe_items").delete().in("id", oldIds);
    if (error) throw error;
  }
  return rid;
}
export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
}
export async function setRecipeFavorite(id: string, favorite: boolean): Promise<void> {
  const { error } = await supabase.from("recipes").update({ favorite }).eq("id", id);
  if (error) throw error;
}

export async function saveTarget(t: Omit<Target, "id">): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("You're signed out. Sign in again.");
  const { error } = await supabase.from("nutrition_targets").upsert({ user_id: u.user.id, ...t }, { onConflict: "user_id,effective_from" });
  if (error) throw error;
}
export async function deleteTarget(id: string): Promise<void> {
  const { error } = await supabase.from("nutrition_targets").delete().eq("id", id);
  if (error) throw error;
}

export async function saveWeight(day: string, kg: number): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("You're signed out. Sign in again.");
  const { error } = await supabase.from("body_weights").upsert({ user_id: u.user.id, measured_on: day, weight_kg: kg }, { onConflict: "user_id,measured_on" });
  if (error) throw error;
}
export async function deleteWeight(id: string): Promise<void> {
  const { error } = await supabase.from("body_weights").delete().eq("id", id);
  if (error) throw error;
}

// ---------- reference foods ----------
let dbCache: DbFood[] | null = null;
let dbLoading: Promise<DbFood[]> | null = null;

/** The McCance & Widdowson reference foods (about 2,900), loaded once per session. */
export function loadFoodDb(): Promise<DbFood[]> {
  if (dbCache) return Promise.resolve(dbCache);
  if (dbLoading) return dbLoading;
  dbLoading = (async () => {
    const all: DbFood[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("food_db").select("id, name, kcal, protein, carbs, fat, fibre").order("id").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) all.push({ ref: r.id as string, source: "cofid", name: r.name as string, brand: null, kcal: n(r.kcal), protein: n(r.protein), carbs: n(r.carbs), fat: n(r.fat), fibre: nn(r.fibre), serving_g: null, serving_label: null, barcode: null });
      if ((data ?? []).length < 1000) break;
    }
    dbCache = all;
    return all;
  })().finally(() => { dbLoading = null; });
  return dbLoading;
}

/** Branded foods from Open Food Facts (Irish and UK products first). */
export async function searchBranded(q: string): Promise<DbFood[]> {
  const { data, error } = await supabase.functions.invoke("food-search", { body: { q } });
  if (error) throw new Error("Couldn't reach Open Food Facts. Try again in a moment.");
  return ((data as { results?: DbFood[] })?.results ?? []).map((x) => ({ ...x, source: "off" as const }));
}

/** One product by barcode from Open Food Facts, or null if it isn't there. */
export async function lookupBarcode(code: string): Promise<DbFood | null> {
  const { data, error } = await supabase.functions.invoke("food-search", { body: { code } });
  if (error) throw new Error("Couldn't reach Open Food Facts. Try again in a moment.");
  const r = (data as { results?: DbFood[] })?.results?.[0];
  return r ? { ...r, source: "off" } : null;
}

/** Your food with this barcode, if you've saved one. */
export const foodByBarcode = (foods: Food[], code: string) => foods.find((f) => !f.archived && (f.barcode === code || (f.source === "off" && f.source_ref === code)));
