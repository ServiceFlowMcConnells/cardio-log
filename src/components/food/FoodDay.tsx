import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Checkin } from "../../lib/readiness";
import type { LogEntry, NewEntry, NutritionData } from "../../lib/nutrition";
import { addDays, addEntries, copyOf, deleteEntries, deleteEntry, fromYmd, hourOf, hourTime, ingredientsFrom, isTime, macrosFor, moveEntries, perServing, scaleMacros, sumMacros, targetFor, todayYmd, updateEntry } from "../../lib/nutrition";
import { HourPicker, MacroInputs, MacroLine, MacroSub, TargetBar, fmtG, fmtKcal, formKcal, macroForm, num, type MacroForm } from "./bits";
import { WeightCard } from "./Weight";

interface Props {
  nutri: NutritionData;
  checkins: Checkin[];
  day: string;
  setDay: (d: string) => void;
  setNutri: (f: (n: NutritionData) => NutritionData) => void;
  onAdd: (time?: string) => void;
  onTargets: () => void;
  onWeight: () => void;
  onMakeRecipe: (items: { food_id: string; grams: number }[]) => void;
}

function dayTitle(d: string) {
  const t = todayYmd();
  if (d === t) return "Today";
  if (d === addDays(t, -1)) return "Yesterday";
  if (d === addDays(t, 1)) return "Tomorrow";
  return fromYmd(d).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" });
}

const amountText = (e: LogEntry) => (e.kind === "quick" ? "quick add" : e.unit === "g" ? `${fmtG(e.amount)} g` : `${fmtG(e.amount)} serving${e.amount === 1 ? "" : "s"}`);

function PencilIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M4 17.2V20h2.8l8.3-8.3-2.8-2.8L4 17.2zm13.7-7.6a1 1 0 0 0 0-1.4l-1.9-1.9a1 1 0 0 0-1.4 0l-1.5 1.5 2.8 2.8 2-1z" /></svg>;
}
function BinIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>;
}
function Check({ on }: { on: boolean }) {
  return (
    <span className={`sel-dot${on ? " on" : ""}`} aria-hidden="true">
      {on && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
    </span>
  );
}

export default function FoodDay({ nutri, checkins, day, setDay, setNutri, onAdd, onTargets, onWeight, onMakeRecipe }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<null | { mode: "copy" | "move"; day: string; time: string }>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Swipe a row left to swap its pencil for a bin
  const [swiped, setSwiped] = useState<string | null>(null);
  const [dragX, setDragX] = useState<{ id: string; dx: number } | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; dx: number; horiz: boolean | null } | null>(null);
  const justSwiped = useRef(false);
  const [undo, setUndo] = useState<LogEntry | null>(null);
  const undoTimer = useRef<number>();

  const onDown = (id: string) => (ev: RPointerEvent) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    drag.current = { id, x: ev.clientX, y: ev.clientY, dx: 0, horiz: null };
  };
  const onMove = (ev: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (d.horiz == null && Math.hypot(dx, dy) > 8) d.horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
    if (!d.horiz) return;
    d.dx = dx;
    const base = swiped === d.id ? -20 : 0;
    setDragX({ id: d.id, dx: Math.max(-48, Math.min(0, base + dx * 0.5)) });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragX(null);
    if (!d || !d.horiz) return;
    justSwiped.current = true;
    window.setTimeout(() => { justSwiped.current = false; }, 50);
    if (d.dx < -40) setSwiped(d.id);
    else if (d.dx > 30 && swiped === d.id) setSwiped(null);
  };

  async function quickDelete(e: LogEntry) {
    setSwiped(null);
    setNutri((n) => ({ ...n, log: n.log.filter((x) => x.id !== e.id) }));
    try {
      await deleteEntry(e.id);
      setUndo(e);
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
    } catch (err) {
      setNutri((n) => ({ ...n, log: [...n.log, e] }));
      setError(err instanceof Error ? err.message : "Couldn't remove that.");
    }
  }
  async function undoDelete() {
    const e = undo;
    if (!e) return;
    setUndo(null);
    try {
      const added = await addEntries([copyOf(e, e.eaten_on, e.eaten_time)]);
      setNutri((n) => ({ ...n, log: [...n.log, ...added] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't put it back.");
    }
  }

  const entries = nutri.log.filter((e) => e.eaten_on === day);
  const total = sumMacros(entries);
  const target = targetFor(nutri.targets, day);
  const left = target ? target.kcal - total.kcal : null;
  const yesterday = nutri.log.filter((e) => e.eaten_on === addDays(day, -1));
  const selected = entries.filter((e) => sel.has(e.id));

  // Every hour from 07:00 (or your first entry) to midday, your last entry, or now
  const hours = entries.map((e) => hourOf(e.eaten_time));
  const isToday = day === todayYmd();
  const first = Math.min(7, ...hours);
  const last = Math.min(23, Math.max(12, ...hours, isToday ? new Date().getHours() : 0));
  const byHour = new Map<number, LogEntry[]>();
  for (const e of entries) byHour.set(hourOf(e.eaten_time), [...(byHour.get(hourOf(e.eaten_time)) ?? []), e]);

  const goDay = (d: string) => { setOpen(null); setSel(new Set()); setSheet(null); setDay(d); };
  const toggle = (ids: string[], on?: boolean) => {
    setOpen(null);
    setSwiped(null);
    setConfirmRemove(false);
    setSel((s) => {
      const n = new Set(s);
      const turnOn = on ?? ids.some((id) => !n.has(id));
      for (const id of ids) turnOn ? n.add(id) : n.delete(id);
      return n;
    });
  };
  const clearSel = () => { setSel(new Set()); setSheet(null); setConfirmRemove(false); };

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      clearSel();
      if (done) { setNote(done); window.setTimeout(() => setNote(null), 2500); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't do that.");
    } finally {
      setBusy(false);
    }
  }

  const copyDay = () => run(async () => {
    const added = await addEntries(yesterday.map((e) => copyOf(e, day, e.eaten_time)));
    setNutri((n) => ({ ...n, log: [...n.log, ...added] }));
  });

  const applySheet = () => sheet && run(async () => {
    if (sheet.mode === "copy") {
      const added = await addEntries(selected.map((e) => copyOf(e, sheet.day, sheet.time)));
      setNutri((n) => ({ ...n, log: [...n.log, ...added] }));
    } else {
      const moved = await moveEntries(selected.map((e) => e.id), sheet.day, sheet.time);
      const m = new Map(moved.map((e) => [e.id, e]));
      setNutri((n) => ({ ...n, log: n.log.map((e) => m.get(e.id) ?? e) }));
    }
  }, `${sheet.mode === "copy" ? "Copied" : "Moved"} ${selected.length} to ${dayTitle(sheet.day).toLowerCase()} at ${sheet.time}`);

  const removeSel = () => run(async () => {
    const ids = selected.map((e) => e.id);
    await deleteEntries(ids);
    setNutri((n) => ({ ...n, log: n.log.filter((e) => !ids.includes(e.id)) }));
  });

  const makeRecipe = () => {
    const { items, skipped } = ingredientsFrom(selected, nutri.foods, nutri.recipes);
    if (!items.length) { setError("Quick adds can't go in a recipe. Select foods you've logged from the database or your foods."); return; }
    if (skipped) setNote(`${skipped} quick add${skipped === 1 ? "" : "s"} left out: a recipe needs foods.`);
    clearSel();
    onMakeRecipe(items);
  };

  const rows: JSX.Element[] = [];
  for (let h = first; h <= last; h++) {
    const t = hourTime(h);
    const list = byHour.get(h) ?? [];
    const allOn = list.length > 0 && list.every((e) => sel.has(e.id));
    const sub = sumMacros(list);
    rows.push(
      <section key={t} className={`hour${list.length ? "" : " empty-hour"}`}>
        <div className="hour-head">
          {list.length > 0 ? (
            <span className="macro-sub big">
              <span className="num">{fmtKcal(sub.kcal)} kcal</span>
              <span className="num">{fmtG(sub.protein)}<b className="p">P</b> {fmtG(sub.fat)}<b className="f">F</b> {fmtG(sub.carbs)}<b className="c">C</b></span>
            </span>
          ) : <span />}
          <span className="hour-tools">
            {list.length > 0
              ? <button className={`time-pill num${allOn ? " on" : ""}`} onClick={() => toggle(list.map((e) => e.id))} aria-label={`Select everything at ${t}`}>{t}</button>
              : <button className="time-pill num" onClick={() => onAdd(t)} aria-label={`Log food at ${t}`}>{t}</button>}
          </span>
        </div>
        {list.length > 0 && (
          <div className="hour-items">
            {list.map((e) => open === e.id ? (
              <div key={e.id} className="panel list-panel"><EntryEditor entry={e} nutri={nutri} setNutri={setNutri} onClose={() => setOpen(null)} /></div>
            ) : (
              <div
                key={e.id}
                className={`food-row${sel.has(e.id) ? " on" : ""}${swiped === e.id ? " swiped" : ""}`}
                onPointerDown={onDown(e.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                style={dragX?.id === e.id ? { transform: `translateX(${dragX.dx}px)`, transition: "none" } : swiped === e.id ? { transform: "translateX(-20px)" } : undefined}
              >
                <button className="food-row-main" onClick={() => { if (justSwiped.current) return; if (swiped) { setSwiped(null); return; } toggle([e.id]); }} aria-pressed={sel.has(e.id)}>
                  <span className="food-row-name">{e.name}</span>
                  <MacroSub m={e} amount={amountText(e)} />
                </button>
                {swiped === e.id
                  ? <button className="pencil bin" aria-label={`Delete ${e.name}`} onClick={() => quickDelete(e)}><BinIcon /></button>
                  : <button className="pencil" aria-label={`Edit ${e.name}`} onClick={() => { if (justSwiped.current) return; clearSel(); setSwiped(null); setOpen(e.id); }}><PencilIcon /></button>}
                {sel.size > 0 && swiped !== e.id && <button className="sel-btn" aria-label={sel.has(e.id) ? "Deselect" : "Select"} onClick={() => toggle([e.id])}><Check on={sel.has(e.id)} /></button>}
              </div>
            ))}
          </div>
        )}
      </section>,
    );
  }

  return (
    <>
      <div className="page-head food-head">
        <h1>Food</h1>
        <div className="day-nav">
          <button className="icon-btn" aria-label="Previous day" onClick={() => goDay(addDays(day, -1))}>‹</button>
          <button className="link day-label" onClick={() => goDay(todayYmd())} title="Back to today">{dayTitle(day)}</button>
          <button className="icon-btn" aria-label="Next day" onClick={() => goDay(addDays(day, 1))}>›</button>
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
              <TargetBar label="Fat" eaten={total.fat} target={target?.fat ?? null} unit="g" cls="f" />
              <TargetBar label="Carbs" eaten={total.carbs} target={target?.carbs ?? null} unit="g" cls="c" />
            </div>
            <button className="link small" style={{ marginTop: 10 }} onClick={onTargets}>{target ? "Edit targets" : "Set your targets from your coach"}</button>
          </section>

          <WeightCard nutri={nutri} checkins={checkins} setNutri={setNutri} onOpen={onWeight} />
        </div>

        <div className="col">
          {error && <p className="error">{error}</p>}
          {note && <p className="ok">{note}</p>}
          {undo && (
            <div className="undo-toast" role="status">
              <span>Removed {undo.name}</span>
              <button className="link small" onClick={undoDelete}>Undo</button>
            </div>
          )}
          <button className="btn primary block log-btn" onClick={() => onAdd()}>+ Log food</button>
          {entries.length === 0 && yesterday.length > 0 && (
            <button className="btn ghost block" disabled={busy} onClick={copyDay} style={{ marginBottom: 10 }}>
              Copy everything from {isToday ? "yesterday" : "the day before"} ({fmtKcal(sumMacros(yesterday).kcal)} kcal)
            </button>
          )}
          {entries.length > 0 && sel.size === 0 && <p className="muted small hint">Tap foods to select them: copy, move, remove or make a recipe. The pencil edits one. Tap an empty hour to log food at that time.</p>}
          <div className="timeline">{rows}</div>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="sel-bar" role="toolbar" aria-label="Selected foods">
          {sheet ? (
            <div className="sel-sheet">
              <strong>{sheet.mode === "copy" ? "Copy" : "Move"} {selected.length} to</strong>
              <div className="sel-sheet-row">
                <input className="input" type="date" value={sheet.day} onChange={(e) => setSheet({ ...sheet, day: e.target.value })} aria-label="Day" />
                <HourPicker value={sheet.time} onChange={(t) => setSheet({ ...sheet, time: t })} />
              </div>
              <div className="sel-sheet-row">
                <button className="btn ghost" onClick={() => setSheet(null)}>Back</button>
                <button className="btn primary" style={{ flex: 1 }} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.day)} onClick={applySheet}>{busy ? "…" : sheet.mode === "copy" ? "Copy here" : "Move here"}</button>
              </div>
            </div>
          ) : (
            <>
              <button className="sel-x" onClick={clearSel} aria-label="Clear selection">✕</button>
              <span className="sel-count"><strong>{selected.length}</strong> selected<span className="small muted" style={{ display: "block" }}>{fmtKcal(sumMacros(selected).kcal)} kcal</span></span>
              <div className="sel-actions">
                <button className="fchip" onClick={() => setSheet({ mode: "copy", day: isToday ? day : todayYmd(), time: selected[0]?.eaten_time.slice(0, 2) + ":00" })}>Copy</button>
                <button className="fchip" onClick={() => setSheet({ mode: "move", day, time: selected[0]?.eaten_time.slice(0, 2) + ":00" })}>Move</button>
                <button className="fchip" onClick={makeRecipe}>Make recipe</button>
                <button className={`fchip danger${confirmRemove ? " on" : ""}`} disabled={busy} onClick={() => (confirmRemove ? removeSel() : setConfirmRemove(true))}>{confirmRemove ? "Tap to confirm" : "Remove"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function EntryEditor({ entry: e, nutri, setNutri, onClose }: { entry: LogEntry; nutri: NutritionData; setNutri: (f: (n: NutritionData) => NutritionData) => void; onClose: () => void }) {
  const food = e.food_id ? nutri.foods.find((f) => f.id === e.food_id) : undefined;
  const recipe = e.recipe_id ? nutri.recipes.find((r) => r.id === e.recipe_id) : undefined;
  const [amount, setAmount] = useState(String(e.amount));
  const [unit, setUnit] = useState(e.unit);
  const [time, setTime] = useState(hourTime(hourOf(e.eaten_time)));
  const [q, setQ] = useState<MacroForm>(() => macroForm(e));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = num(amount);

  let macros = null as null | { kcal: number; protein: number; carbs: number; fat: number };
  if (e.kind === "quick") {
    const k = formKcal(q);
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
    if (!isTime(time)) return;
    const next: NewEntry = { eaten_on: e.eaten_on, eaten_time: time, kind: e.kind, food_id: e.food_id, recipe_id: e.recipe_id, name: e.name, amount: e.kind === "quick" ? 1 : a!, unit: e.kind === "quick" ? "serving" : unit, ...macros };
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
        <MacroInputs v={q} set={setQ} />
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
      <div className="field" style={{ marginTop: 10 }}>
        <span className="small muted" style={{ display: "block", marginBottom: 4 }}>Time</span>
        <HourPicker value={time} onChange={setTime} />
      </div>
      {macros && <p className="small" style={{ marginTop: 8 }}><MacroLine m={macros} /></p>}
      {error && <p className="error">{error}</p>}
      <div className="tpl-foot">
        <button className="btn danger" disabled={busy} onClick={remove}>Delete</button>
        <button className="btn primary" disabled={busy || !macros || !isTime(time)} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
