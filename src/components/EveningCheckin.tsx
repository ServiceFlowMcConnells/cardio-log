import { useEffect, useState } from "react";
import { useBackHandler } from "../lib/backNav";
import { Rating } from "./ReadinessScan";
import { SLOTS, activeItems, useSupplementItems } from "../lib/supplements";
import { saveEvening, snapshotOf, useEvenings, type EveningCheckin as Evening, type StackEntry } from "../lib/evening";
import { addMeditation, minutesByDay, useMeditation } from "../lib/meditation";
import { todayYmd } from "../lib/nutrition";

const STRESS = ["Very low", "Low", "Moderate", "High", "Very high"];
const DAY = ["Awful", "Bad", "Meh", "Good", "Great"];

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

  type Step = "stack" | "mind" | "day" | "good";
  const steps: Step[] = [...(stack.length ? (["stack"] as Step[]) : []), "mind", "day", "good"];
  const [si, setSi] = useState(0);
  const step = steps[Math.min(si, steps.length - 1)];
  const last = si >= steps.length - 1;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [si]);
  const back = () => (si === 0 ? onClose() : setSi(si - 1));
  useBackHandler(si > 0, back);

  return (
    <div className="scan-steps evening">
      <div className="scan-top">
        <button className="icon-btn" onClick={back} aria-label={si === 0 ? "Cancel" : "Back"}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <span className="kicker">{isToday ? "Evening check-in" : label} · {si + 1} of {steps.length}</span>
        <button className="link small" onClick={onClose}>Cancel</button>
      </div>
      <div className="ticker scan-prog" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={si + 1} aria-label="Progress">
        {steps.map((_, i) => <span key={i} className={`tick${i <= si ? " on" : ""}`} />)}
      </div>

      {step === "stack" && (
        <div className="scan-step">
          <span className="kicker">{taken} of {stack.length} taken{existing ? " · your list as it was that day" : ""}</span>
          <h1 className="scan-q">Supplements today</h1>
          {SLOTS.map((slot) => {
            const list = stack.filter((s) => s.slot === slot.id);
            if (!list.length) return null;
            const allOn = list.every((s) => s.taken);
            return (
              <div key={slot.id} className="ev-slot">
                <div className="ev-slot-head">
                  <span className="sym-h small">{slot.title}</span>
                  <button className="link small" onClick={() => setSlot(slot.id, !allOn)}>{allOn ? "Clear" : "All"}</button>
                </div>
                <div className="scan-list ev-list">
                  {list.map((s) => (
                    <button key={s.id} role="checkbox" aria-checked={s.taken} className={s.taken ? "on" : ""} onClick={() => toggle(s.id)}>
                      <span className="ev-tick" aria-hidden="true">{s.taken ? "✓" : ""}</span>
                      <span><strong>{s.name}</strong>{s.dose && <span className="muted small"> · {s.dose}</span>}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === "mind" && (
        <div className="scan-step">
          <span className="kicker">Optional</span>
          <Rating label="Stress today" hint="" labels={STRESS} value={stress} onChange={setStress} onClear={() => setStress(null)} invert />
          <div className="scan-hours">
            <span className="kicker">Meditation{medMin ? ` · ${medMin} min already logged` : ""}</span>
            <div className="stepper scan-stepper">
              <button type="button" onClick={() => setMedAdd(String(Math.max(0, (Number(medAdd) || 0) - 5) || ""))} aria-label="5 minutes less">−</button>
              <input className="input" inputMode="numeric" placeholder="0" value={medAdd} onChange={(e) => setMedAdd(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Meditation minutes to add" />
              <button type="button" onClick={() => setMedAdd(String((Number(medAdd) || 0) + 5))} aria-label="5 minutes more">+</button>
            </div>
            <span className="small muted">Minutes to add to your meditation log</span>
          </div>
        </div>
      )}

      {step === "day" && (
        <div className="scan-step">
          <span className="kicker">Optional</span>
          <Rating label="How was the day?" hint="" labels={DAY} value={rating} onChange={setRating} onClear={() => setRating(null)} />
          <div className="rating">
            <div className="rating-head"><h3 style={{ fontSize: "1.3rem" }}>Screens in the last hour before bed?</h3></div>
            <div className="scan-big2 two" role="radiogroup" aria-label="Screens in the last hour before bed">
              <button role="radio" aria-checked={screens === false} className={screens === false ? "on" : ""} onClick={() => { setScreens(screens === false ? null : false); }}><b>No</b><span>Screens off</span></button>
              <button role="radio" aria-checked={screens === true} className={screens === true ? "on" : ""} onClick={() => { setScreens(screens === true ? null : true); }}><b>Yes</b><span>Phone, TV or laptop</span></button>
            </div>
          </div>
        </div>
      )}

      {step === "good" && (
        <div className="scan-step">
          <span className="kicker">Optional · small is fine, a good coffee counts</span>
          <h1 className="scan-q">Three good things</h1>
          {good.map((g, i) => (
            <input key={i} className="input ev-good" value={g} maxLength={200} placeholder={`${i + 1}.`} onChange={(e) => setGood((x) => x.map((y, j) => (j === i ? e.target.value : y)))} aria-label={`Good thing ${i + 1}`} />
          ))}
          <label className="field"><span>Note</span><textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering about today" /></label>
        </div>
      )}

      {error && <p className="error panel" role="alert">{error}</p>}
      <div className="scan-foot">
        {last
          ? <button className="btn primary block" onClick={save} disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Save check-in"}</button>
          : <button className="btn primary block" onClick={() => setSi(si + 1)}>Next</button>}
      </div>
    </div>
  );
}
