import { useState } from "react";
import type { Checkin } from "../../lib/readiness";
import type { LogEntry, MealIndex, NewEntry, NutritionData } from "../../lib/nutrition";
import { MEALS, addDays, addEntries, deleteEntry, fromYmd, macrosFor, mealForNow, perServing, scaleMacros, sumMacros, targetFor, todayYmd, updateEntry } from "../../lib/nutrition";
import { MacroLine, TargetBar, fmtG, fmtKcal, num } from "./bits";
import { WeightCard } from "./Weight";

interface Props {
  nutri: NutritionData;
  checkins: Checkin[];
  day: string;
  setDay: (d: string) => void;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onAdd: (meal: MealIndex) => void;
  onTargets: () => void;
  onWeight: () => void;
}

function dayTitle(d: string) {
  const t = todayYmd();
  if (d === t) return "Today";
  if (d === addDays(t, -1)) return "Yesterday";
  if (d === addDays(t, 1)) return "Tomorrow";
  return fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" });
}

const amountText = (e: LogEntry) => (e.kind === "quick" ? "Quick add" : e.unit === "g" ? `${fmtG(e.amount)} g` : `${fmtG(e.amount)} serving${e.amount === 1 ? "" : "s"}`);

export default function FoodDay({ nutri, checkins, day, setDay, setNutri, onAdd, onTargets, onWeight }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = nutri.log.filter((e) => e.eaten_on === day);
  const total = sumMacros(entries);
  const target = targetFor(nutri.targets, day);
  const left = target ? target.kcal - total.kcal : null;
  const yesterday = nutri.log.filter((e) => e.eaten_on === addDays(day, -1));

  async function copy(from: LogEntry[], meal?: MealIndex) {
    setBusy(true);
    setError(null);
    try {
      const added = await addEntries(from.filter((e) => meal == null || e.meal === meal).map((e) => ({ eaten_on: day, meal: e.meal, kind: e.kind, food_id: e.food_id, recipe_id: e.recipe_id, name: e.name, amount: e.amount, unit: e.unit, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat })));
      setNutri((n) => ({ ...n, log: [...n.log, ...added] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't copy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head food-head">
        <h1>Food</h1>
        <div className="day-nav">
          <button className="icon-btn" aria-label="Previous day" onClick={() => { setOpen(null); setDay(addDays(day, -1)); }}>‹</button>
          <button className="link day-label" onClick={() => setDay(todayYmd())} title="Back to today">{dayTitle(day)}</button>
          <button className="icon-btn" aria-label="Next day" onClick={() => { setOpen(null); setDay(addDays(day, 1)); }}>›</button>
        </div>
      </div>

      <div className="cols">
        <div className="col">
          <section className="panel food-sum">
            <div className="fs-top">
              <div>
                <span className="fs-big num">{fmtKcal(total.kcal)}</span>
                <span className="muted"> {target ? `of ${fmtKcal(target.kcal)} kcal` : "kcal"}</span>
              </div>
              {left != null && (
                <div className={`fs-left${left < 0 ? " over" : ""}`}>
                  <span className="num">{fmtKcal(Math.abs(left))}</span>
                  <span className="small">{left < 0 ? "over" : "left"}</span>
                </div>
              )}
            </div>
            {target && <div className="tbar-track big"><div className={`tbar-fill k${left! < -target.kcal * 0.05 ? " over" : ""}`} style={{ width: `${Math.min(100, (total.kcal / target.kcal) * 100)}%` }} /></div>}
            <div className="fs-macros">
              <TargetBar label="Protein" eaten={total.protein} target={target?.protein ?? null} unit="g" cls="p" />
              <TargetBar label="Carbs" eaten={total.carbs} target={target?.carbs ?? null} unit="g" cls="c" />
              <TargetBar label="Fat" eaten={total.fat} target={target?.fat ?? null} unit="g" cls="f" />
            </div>
            <button className="link small" style={{ marginTop: 10 }} onClick={onTargets}>{target ? "Edit targets" : "Set your targets from your coach"}</button>
          </section>

          <WeightCard nutri={nutri} checkins={checkins} setNutri={setNutri} onOpen={onWeight} />
        </div>

        <div className="col">
          {error && <p className="error">{error}</p>}
          {entries.length === 0 && yesterday.length > 0 && (
            <button className="btn ghost block" disabled={busy} onClick={() => copy(yesterday)} style={{ marginBottom: 10 }}>
              Copy everything from {day === todayYmd() ? "yesterday" : "the day before"} ({fmtKcal(sumMacros(yesterday).kcal)} kcal)
            </button>
          )}
          {MEALS.map((name, i) => {
            const meal = i as MealIndex;
            const list = entries.filter((e) => e.meal === meal);
            const prev = yesterday.filter((e) => e.meal === meal);
            const sub = sumMacros(list);
            return (
              <section key={name} className={`meal${meal === mealForNow() && day === todayYmd() ? " now" : ""}`}>
                <div className="meal-head">
                  <h2>{name}</h2>
                  <span className="muted small num">{list.length ? `${fmtKcal(sub.kcal)} kcal · P ${fmtG(sub.protein)}` : ""}</span>
                </div>
                <div className="panel list-panel">
                  {list.map((e) => open === e.id ? (
                    <EntryEditor key={e.id} entry={e} nutri={nutri} setNutri={setNutri} onClose={() => setOpen(null)} />
                  ) : (
                    <button key={e.id} className="list-row entry-row" onClick={() => setOpen(e.id)}>
                      <span style={{ minWidth: 0 }}>
                        <span className="entry-name">{e.name}</span>
                        <span className="small muted" style={{ display: "block" }}>{amountText(e)} · P {fmtG(e.protein)} · C {fmtG(e.carbs)} · F {fmtG(e.fat)}</span>
                      </span>
                      <span className="num entry-k">{fmtKcal(e.kcal)}</span>
                    </button>
                  ))}
                  <div className="meal-foot">
                    <button className="link small" onClick={() => onAdd(meal)}>+ Add food</button>
                    {list.length === 0 && prev.length > 0 && entries.length > 0 && (
                      <button className="link small muted-link" disabled={busy} onClick={() => copy(yesterday, meal)}>Copy {day === todayYmd() ? "yesterday's" : "previous"} ({fmtKcal(sumMacros(prev).kcal)} kcal)</button>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

function EntryEditor({ entry: e, nutri, setNutri, onClose }: { entry: LogEntry; nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose: () => void }) {
  const food = e.food_id ? nutri.foods.find((f) => f.id === e.food_id) : undefined;
  const recipe = e.recipe_id ? nutri.recipes.find((r) => r.id === e.recipe_id) : undefined;
  const [amount, setAmount] = useState(String(e.amount));
  const [unit, setUnit] = useState(e.unit);
  const [meal, setMeal] = useState<MealIndex>(e.meal);
  const [q, setQ] = useState({ kcal: String(Math.round(e.kcal)), protein: fmtG(e.protein), carbs: fmtG(e.carbs), fat: fmtG(e.fat) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = num(amount);

  let macros = null as null | { kcal: number; protein: number; carbs: number; fat: number };
  if (e.kind === "quick") {
    const k = num(q.kcal);
    macros = k != null && k > 0 ? { kcal: k, protein: num(q.protein) ?? 0, carbs: num(q.carbs) ?? 0, fat: num(q.fat) ?? 0 } : null;
  } else if (a != null && a > 0) {
    if (food) macros = macrosFor(food, a, unit);
    else if (recipe) macros = scaleMacros(perServing(recipe, nutri.foods), a);
    else macros = scaleMacros(e, a / e.amount); // food since removed: scale what was logged
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't save."); setBusy(false); }
  }

  const save = () => run(async () => {
    if (!macros) return;
    const next: NewEntry = { eaten_on: e.eaten_on, meal, kind: e.kind, food_id: e.food_id, recipe_id: e.recipe_id, name: e.name, amount: e.kind === "quick" ? 1 : a!, unit: e.kind === "quick" ? "serving" : unit, ...macros };
    const saved = await updateEntry(e.id, next);
    setNutri((n) => ({ ...n, log: n.log.map((x) => (x.id === e.id ? saved : x)) }));
  });
  const remove = () => run(async () => {
    await deleteEntry(e.id);
    setNutri((n) => ({ ...n, log: n.log.filter((x) => x.id !== e.id) }));
  });

  return (
    <div className="entry-edit">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <strong>{e.name}</strong>
        <button className="link small" onClick={onClose}>Close</button>
      </div>
      {e.kind === "quick" ? (
        <div className="grid c4">
          {(["kcal", "protein", "carbs", "fat"] as const).map((k) => (
            <label className="field" key={k}><span>{k === "kcal" ? "kcal" : `${k[0].toUpperCase()}${k.slice(1)} g`}</span><input className="input" inputMode="decimal" value={q[k]} onChange={(ev) => setQ({ ...q, [k]: ev.target.value })} /></label>
          ))}
        </div>
      ) : (
        <div className="amount-row">
          <label className="field" style={{ flex: 1 }}>
            <span>{unit === "g" ? "Grams" : "Servings"}</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} onFocus={(ev) => ev.target.select()} />
          </label>
          {food?.serving_g && (
            <div className="seg unit-seg" role="group" aria-label="Unit">
              <button className={unit === "serving" ? "on" : ""} aria-pressed={unit === "serving"} onClick={() => { if (a && unit === "g") setAmount(String(Math.round((a / food.serving_g!) * 100) / 100)); setUnit("serving"); }}>Serving</button>
              <button className={unit === "g" ? "on" : ""} aria-pressed={unit === "g"} onClick={() => { if (a && unit === "serving") setAmount(String(Math.round(a * food.serving_g!))); setUnit("g"); }}>g</button>
            </div>
          )}
        </div>
      )}
      <div className="seg meal-seg" role="group" aria-label="Meal" style={{ marginTop: 10 }}>
        {MEALS.map((m, i) => <button key={m} className={meal === i ? "on" : ""} aria-pressed={meal === i} onClick={() => setMeal(i as MealIndex)}>{m}</button>)}
      </div>
      {macros && <p className="small" style={{ marginTop: 8 }}><MacroLine m={macros} /></p>}
      {error && <p className="error">{error}</p>}
      <div className="tpl-foot">
        <button className="btn danger" disabled={busy} onClick={remove}>Delete</button>
        <button className="btn primary" disabled={busy || !macros} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
