import { useState } from "react";
import { SLOTS, activeItems, useSupplementItems } from "../lib/supplements";
import { saveEvening, snapshotOf, useEvenings, type EveningCheckin as Evening, type StackEntry } from "../lib/evening";
import { addMeditation, minutesByDay, useMeditation } from "../lib/meditation";
import { todayYmd } from "../lib/nutrition";

const STRESS = ["Very low", "Low", "Moderate", "High", "Very high"];
const DAY = ["Awful", "Bad", "Meh", "Good", "Great"];

function Scale({ label, labels, value, onChange }: { label: string; labels: string[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="rating">
      <div className="rating-head"><h3>{label}</h3><span className="muted small">{value ? labels[value - 1] : "Optional"}</span></div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {labels.map((l, i) => <button key={l} role="radio" aria-checked={value === i + 1} aria-label={l} className={value === i + 1 ? "on" : ""} onClick={() => onChange(value === i + 1 ? null : i + 1)}>{i + 1}</button>)}
      </div>
    </div>
  );
}

/** The evening check-in for one day: supplements taken, meditation, stress, day rating, screens before bed,
 *  three good things and a note. */
export default function EveningCheckin({ day, onClose }: { day: string; onClose: () => void }) {
  const items = useSupplementItems();
  const evenings = useEvenings();
  const med = useMeditation();
  const existing = evenings?.find((e) => e.day === day) ?? null;
  const ready = items != null && evenings != null;
  if (!ready) return <p className="muted small" style={{ padding: 16 }}>Loading…</p>;
  return <Form key={existing?.id ?? "new"} day={day} onClose={onClose} existing={existing} snapshot={existing ? existing.stack : snapshotOf(activeItems(items))} medMin={med ? minutesByDay(med).get(day) ?? 0 : 0} />;
}

function Form({ day, onClose, existing, snapshot, medMin }: { day: string; onClose: () => void; existing: Evening | null; snapshot: StackEntry[]; medMin: number }) {
  const [stack, setStack] = useState<StackEntry[]>(snapshot);
  const [stress, setStress] = useState<number | null>(existing?.stress ?? null);
  const [rating, setRating] = useState<number | null>(existing?.day_rating ?? null);
  const [screens, setScreens] = useState<boolean | null>(existing?.screens_before_bed ?? null);
  const [good, setGood] = useState<string[]>(() => { const g = [...(existing?.gratitude ?? [])]; while (g.length < 3) g.push(""); return g; });
  const [note, setNote] = useState(existing?.note ?? "");
  const [medAdd, setMedAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isToday = day === todayYmd();
  const label = isToday ? "Tonight" : new Date(`${day}T12:00:00`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" });
  const toggle = (id: string) => setStack((s) => s.map((x) => (x.id === id ? { ...x, taken: !x.taken } : x)));
  const setSlot = (slot: string, v: boolean) => setStack((s) => s.map((x) => (x.slot === slot ? { ...x, taken: v } : x)));
  const taken = stack.filter((s) => s.taken).length;

  async function save() {
    setBusy(true); setError(null);
    try {
      const m = Number(medAdd);
      if (medAdd.trim() && (!Number.isFinite(m) || m < 1 || m > 600)) throw new Error("Meditation minutes should be between 1 and 600.");
      if (medAdd.trim()) await addMeditation(day, Math.round(m));
      await saveEvening({ day, stack, stress, day_rating: rating, screens_before_bed: screens, gratitude: good, note });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the check-in.");
      setBusy(false);
    }
  }

  return (
    <div className="evening">
      <div className="editor-bar">
        <div>
          <span className="kicker">Evening check-in · {label}</span>
          <h1>How was today?</h1>
        </div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <section className="panel ev-sec">
        <div className="rating-head"><h3>Supplements</h3><span className="muted small">{stack.length ? `${taken} of ${stack.length} taken` : "None on your list"}</span></div>
        {existing && <p className="small muted" style={{ margin: "0 0 6px" }}>Your list as it was that day.</p>}
        {SLOTS.map((slot) => {
          const list = stack.filter((s) => s.slot === slot.id);
          if (!list.length) return null;
          const allOn = list.every((s) => s.taken);
          return (
            <div key={slot.id} className="ev-slot">
              <div className="ev-slot-head">
                <span className="sym-h small">{slot.title}</span>
                <button className="link small" onClick={() => setSlot(slot.id, !allOn)}>{allOn ? "Clear" : `All of ${slot.title.toLowerCase()}`}</button>
              </div>
              {list.map((s) => (
                <label key={s.id} className={`ev-item${s.taken ? " on" : ""}`}>
                  <input type="checkbox" checked={s.taken} onChange={() => toggle(s.id)} />
                  <span><strong>{s.name}</strong>{s.dose && <span className="muted small"> · {s.dose}</span>}</span>
                </label>
              ))}
            </div>
          );
        })}
      </section>

      <section className="panel ev-sec">
        <div className="rating-head"><h3>Meditation</h3><span className="muted small">{medMin ? `${medMin} min logged` : "None logged"}</span></div>
        <div className="ev-med">
          <input className="input" inputMode="numeric" placeholder="Add minutes" value={medAdd} onChange={(e) => setMedAdd(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Meditation minutes to add" />
          <span className="small muted">Added to your meditation log when you save.</span>
        </div>
      </section>

      <section className="panel ev-sec stack">
        <Scale label="Stress" labels={STRESS} value={stress} onChange={setStress} />
        <Scale label="Day rating" labels={DAY} value={rating} onChange={setRating} />
        <div className="rating">
          <div className="rating-head"><h3>Screens in the last hour before bed</h3><span className="muted small">{screens == null ? "Optional" : screens ? "Yes" : "No"}</span></div>
          <div className="seg" role="radiogroup" aria-label="Screens in the last hour before bed">
            <button role="radio" aria-checked={screens === false} className={screens === false ? "on" : ""} onClick={() => setScreens(screens === false ? null : false)}>No</button>
            <button role="radio" aria-checked={screens === true} className={screens === true ? "on" : ""} onClick={() => setScreens(screens === true ? null : true)}>Yes</button>
          </div>
        </div>
      </section>

      <section className="panel ev-sec">
        <div className="rating-head"><h3>Three good things</h3><span className="muted small">Optional</span></div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>Small is fine: a good coffee counts.</p>
        {good.map((g, i) => (
          <input key={i} className="input ev-good" value={g} maxLength={200} placeholder={`${i + 1}.`} onChange={(e) => setGood((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Good thing ${i + 1}`} />
        ))}
      </section>

      <section className="panel ev-sec">
        <div className="rating-head"><h3>Note</h3><span className="muted small">Optional</span></div>
        <textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering about today" />
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" onClick={save} disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Save check-in"}</button>
      </div>
    </div>
  );
}
