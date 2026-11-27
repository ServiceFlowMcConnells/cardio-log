import { useEffect, useRef, useState } from "react";
import { useBackHandler } from "../lib/backNav";
import Chevrons from "./Chevrons";
import type { DayActivity } from "../lib/health";
import { hm } from "../lib/health";
import type { Checkin, Phase } from "../lib/readiness";
import {
  BAND_LABEL, ENERGY_LABELS, PHASE_LABEL, PHASE_RATE, SLEEP_LABELS, SORENESS_LABELS, adjustmentFor, bandFor, latestPhase, scoreReadiness, weeklyLossPct,
} from "../lib/readiness";
import { deleteCheckin, saveCheckin } from "../lib/strengthData";
import { formatDay, formatTime } from "../lib/dates";
import type { SickChoice } from "../lib/illness";
import { CHOICE_LABEL, SYMPTOMS, belowNeck, stillUnwell } from "../lib/illness";
import { GAD_INTRO, GAD_ITEMS, GAD_OPTIONS, HEADSPACE_NAME, MOOD_LABELS, gadBand, gadDue, gadScore } from "../lib/mood";

interface Props {
  existing: Checkin | null;
  checkins: Checkin[];
  saveLabel: string;
  onSaved: (c: Checkin) => void;
  onSkip?: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
  /** Last night from Health Connect (the sleep that ended this morning), if synced */
  hcSleep?: DayActivity | null;
  /** That day's weigh-in from the weight log, if there is one: used for the scan's weight. */
  dayWeight?: number | null;
  /** That day's calorie target from Food → Targets: used for the scan's calories. */
  dayTarget?: number | null;
}

function Rating({ label, hint, labels, value, onChange, onClear }: { label: string; hint: string; labels: string[]; value: number | null; onChange: (v: number) => void; onClear?: () => void }) {
  const id = label.replace(/\W/g, "");
  return (
    <div className="rating">
      <div className="rating-head">
        <h3 id={id}>{label}</h3>
        <span className="muted small">
          {value ? labels[value - 1] : hint}
          {onClear && value != null && <> · <button type="button" className="link small" onClick={onClear}>Clear</button></>}
        </span>
      </div>
      <div className="rating-row" role="radiogroup" aria-labelledby={id}>
        {labels.map((l, i) => (
          <button key={i} role="radio" aria-checked={value === i + 1} aria-label={`${i + 1}, ${l}`} className={`r${i + 1}${value === i + 1 ? " on" : ""}`} onClick={() => onChange(i + 1)}>
            <span className="rn">{i + 1}</span>
            <span className="rl">{l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const parse = (s: string) => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export default function ReadinessScan({ existing, checkins, saveLabel, onSaved, onSkip, onCancel, onDeleted, hcSleep, dayWeight, dayTarget }: Props) {
  const hcHours = hcSleep?.sleep_minutes != null ? Math.round((hcSleep.sleep_minutes / 60) * 4) / 4 : null;
  const last = checkins.find((c) => c.id !== existing?.id);
  const lastWeight = checkins.find((c) => c.id !== existing?.id && c.bodyweight_kg != null)?.bodyweight_kg ?? null;
  const [sleepQ, setSleepQ] = useState<number | null>(existing?.sleep_quality ?? null);
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null);
  const [soreness, setSoreness] = useState<number | null>(existing?.soreness ?? null);
  const [hours, setHours] = useState(existing?.sleep_hours != null ? String(existing.sleep_hours) : hcHours != null ? String(hcHours) : last?.sleep_hours != null ? String(last.sleep_hours) : "");
  const [weight, setWeight] = useState(existing?.bodyweight_kg != null ? String(existing.bodyweight_kg) : dayWeight != null ? String(dayWeight) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // Nutrition phase and calories carry forward from your last scan
  const prevPhase = latestPhase(checkins.filter((c) => c.id !== existing?.id));
  const prevCalories = checkins.find((c) => c.id !== existing?.id && c.calories != null)?.calories ?? null;
  const [phase, setPhase] = useState<Phase | null>(existing ? existing.calorie_status : prevPhase);
  const [calories, setCalories] = useState(existing?.calories != null ? String(existing.calories) : dayTarget != null ? String(Math.round(dayTarget)) : prevCalories != null ? String(prevCalories) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Sickness: carries over from your last scan until you say you're better
  const prevSick = existing ? null : stillUnwell(checkins);
  const [unwell, setUnwell] = useState<boolean>(existing ? Boolean(existing.sick) : prevSick != null);
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? prevSick?.symptoms ?? []);
  const [choice, setChoice] = useState<SickChoice | null>(existing?.sick_choice ?? (prevSick && !belowNeck(prevSick.symptoms ?? []) ? prevSick.sick_choice ?? null : null));
  const forcedRest = unwell && belowNeck(symptoms);
  const sickChoice: SickChoice | null = !unwell ? null : forcedRest ? "rest" : choice;
  const toggleSymptom = (id: string) => setSymptoms((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Mood (optional) and the fortnightly Headspace check-in
  const [mood, setMood] = useState<number | null>(existing?.mood ?? null);
  const gadAsk = existing ? Boolean(existing.gad7) : gadDue(checkins);
  const [gad, setGad] = useState<(number | null)[]>(existing?.gad7 ?? Array(7).fill(null));
  const [gadSkip, setGadSkip] = useState(false);
  const gadDone = gad.every((v) => v != null);
  const gadStarted = gad.some((v) => v != null);

  const at = existing?.checked_at ?? new Date().toISOString();
  const h = parse(hours);
  const w = parse(weight);
  const hoursOk = h == null || (!Number.isNaN(h) && h >= 0 && h <= 16);
  const weightOk = w == null || (!Number.isNaN(w) && w >= 30 && w <= 300);
  const kcal = parse(calories);
  const kcalOk = kcal == null || (!Number.isNaN(kcal) && Number.isInteger(kcal) && kcal >= 800 && kcal <= 8000);
  const complete = sleepQ != null && energy != null && soreness != null;
  const history = checkins.filter((c) => c.id !== existing?.id);
  const result = complete && hoursOk && weightOk
    ? scoreReadiness({ sleep_quality: sleepQ!, energy: energy!, soreness: soreness!, sleep_hours: h, bodyweight_kg: w, at, calorie_status: phase }, history)
    : null;
  const adj = result ? adjustmentFor({ score: result.score, soreness: soreness! }) : null;
  const rate = w != null && weightOk ? weeklyLossPct([...history, { checked_at: at, bodyweight_kg: w }]) : null;

  const stepHours = (d: number) => {
    const cur = h != null && !Number.isNaN(h) ? h : 7.5;
    setHours(String(Math.max(0, Math.min(16, Math.round((cur + d) * 2) / 2))));
  };

  // ---------- Stepped flow (new scans): one topic per screen ----------
  type Step = "feel" | "sleep" | "body" | "mood" | "head" | "details" | "result";
  const steps: Step[] = ["feel", "sleep", "body", "mood", ...(gadAsk ? (["head"] as Step[]) : []), "details", "result"];
  const [si, setSi] = useState(0);
  const [gq, setGq] = useState(0); // which Headspace question
  const [editCal, setEditCal] = useState(false);
  const [editWeight, setEditWeight] = useState(false);
  const [saved, setSaved] = useState<Checkin | null>(null);
  const step = steps[Math.min(si, steps.length - 1)];
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: "start" }); window.scrollTo({ top: 0 }); }, [si]);
  const next = () => setSi((i) => Math.min(i + 1, steps.length - 1));
  const back = () => {
    if (step === "head" && gq > 0) return setGq((q) => q - 1);
    if (si === 0 || step === "result") return onCancel();
    setSi((i) => i - 1);
  };
  useBackHandler(!existing && si > 0 && step !== "result", back);
  const later = (fn: () => void) => window.setTimeout(fn, 220); // let the tap show before moving on

  async function save(stay = false) {
    if (unwell && !symptoms.length) return setError("Tick at least one symptom, or switch back to I'm well.");
    if (unwell && !sickChoice) return setError("Choose what to do with today's session.");
    if (gadAsk && !gadSkip && gadStarted && !gadDone) return setError(`Answer all seven ${HEADSPACE_NAME} questions, or skip them for today.`);
    if (!complete) return setError("Rate sleep, energy and soreness first.");
    if (!hoursOk) return setError("Hours of sleep should be between 0 and 16.");
    if (!weightOk) return setError("Bodyweight should be between 30 and 300 kg.");
    if (!kcalOk) return setError("Daily calories should be a whole number between 800 and 8000, or blank.");
    setBusy(true);
    setError(null);
    try {
      const c = await saveCheckin({
        id: existing?.id, checked_at: at, sleep_quality: sleepQ!, energy: energy!, soreness: soreness!,
        sleep_hours: h, bodyweight_kg: w, score: result!.score, notes: notes || null,
        calorie_status: phase, calories: kcal,
        sick: unwell, symptoms: unwell ? symptoms : [], sick_choice: sickChoice,
        mood, gad7: gadAsk && gadDone && !gadSkip ? (gad as number[]) : null, gad7_skipped: gadAsk && !existing && !gadDone,
      });
      if (stay) { setSaved(c); setBusy(false); next(); } else onSaved(c);
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try { await deleteCheckin(existing.id); onDeleted?.(); } catch (e) {
      setError(e instanceof Error ? `Couldn't delete: ${e.message}` : "Couldn't delete.");
      setBusy(false);
    }
  }

  if (!existing) {
    const total = steps.length - 1;
    const gadAnswer = (v: number) => {
      setGad((g) => g.map((x, j) => (j === gq ? v : x)));
      later(() => { if (gq < 6) setGq(gq + 1); else next(); });
    };
    const avg28 = (() => {
      const cut = Date.now() - 28 * 86400000;
      const xs = history.filter((c) => new Date(c.checked_at).getTime() >= cut).map((c) => c.score);
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    })();
    const feelOk = !unwell || (symptoms.length > 0 && sickChoice != null);
    return (
      <div className="scan-steps" ref={top}>
        <div className="scan-top">
          <button className="icon-btn" onClick={back} aria-label={si === 0 ? "Cancel" : "Back"}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <span className="kicker">{step === "result" ? "Readiness scan" : `Readiness scan · ${si + 1} of ${total}`}</span>
          {step === "result" ? <span /> : <button className="link small" onClick={onCancel}>Cancel</button>}
        </div>
        {step !== "result" && (
          <div className="ticker scan-prog" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={si + 1} aria-label="Progress">
            {Array.from({ length: total }, (_, i) => <span key={i} className={`tick${i <= si ? " on" : ""}`} />)}
          </div>
        )}

        {step === "feel" && (
          <div className="scan-step">
            <span className="kicker">Before anything else</span>
            <h1 className="scan-q">{prevSick ? "Still unwell?" : "How are you feeling?"}</h1>
            {prevSick && <p className="small muted" style={{ margin: "-6px 0 10px" }}>Carried over from {formatDay(new Date(prevSick.checked_at))}</p>}
            <div className="scan-big2" role="radiogroup" aria-label="How are you feeling?">
              <button role="radio" aria-checked={!unwell} className={!unwell ? "on" : ""} onClick={() => setUnwell(false)}><b>{prevSick ? "I'm better" : "I'm well"}</b><span>Straight on</span></button>
              <button role="radio" aria-checked={unwell} className={unwell ? "on" : ""} onClick={() => setUnwell(true)}><b>{prevSick ? "Still unwell" : "I'm unwell"}</b><span>Symptoms and what to do today</span></button>
            </div>
            {unwell && (
              <div className="scan-sick">
                <div className="sym-groups">
                  <div>
                    <span className="sym-h small">Above the neck</span>
                    <div className="chips">{SYMPTOMS.filter((x) => x.above).map((x) => <button key={x.id} type="button" className={`chip-btn${symptoms.includes(x.id) ? " on" : ""}`} aria-pressed={symptoms.includes(x.id)} onClick={() => toggleSymptom(x.id)}>{x.label}</button>)}</div>
                  </div>
                  <div>
                    <span className="sym-h small">Below the neck or all over</span>
                    <div className="chips">{SYMPTOMS.filter((x) => !x.above).map((x) => <button key={x.id} type="button" className={`chip-btn bad${symptoms.includes(x.id) ? " on" : ""}`} aria-pressed={symptoms.includes(x.id)} onClick={() => toggleSymptom(x.id)}>{x.label}</button>)}</div>
                  </div>
                </div>
                {symptoms.length > 0 && (forcedRest ? (
                  <div className="sick-verdict rest">
                    <strong>Rest today.</strong> With symptoms below the neck{symptoms.includes("fever") ? " or a fever" : ""}, training makes things worse. Today's strength session is skipped (the program waits) and planned cardio is cleared.
                    {symptoms.includes("fever") && " Once you're better, you'll get a full day clear of fever before lifting again."}
                  </div>
                ) : (
                  <>
                    <p className="small" style={{ margin: "12px 0 6px" }}>Above the neck only, so light training is usually fine. What would you like to do today?</p>
                    <div className="seg" role="radiogroup" aria-label="Today's session">
                      {(["normal", "light", "rest"] as SickChoice[]).map((c) => <button key={c} role="radio" aria-checked={choice === c} className={choice === c ? "on" : ""} onClick={() => setChoice(c)}>{CHOICE_LABEL[c]}</button>)}
                    </div>
                  </>
                ))}
                <p className="small muted sick-flags">See a doctor if you have chest pain, trouble breathing, or a fever that lasts more than a few days.</p>
              </div>
            )}
            {onSkip && !unwell && <button className="link small scan-skip" onClick={onSkip}>Skip the scan, use the plan as written</button>}
          </div>
        )}

        {step === "sleep" && (
          <div className="scan-step">
            <span className="kicker">Last night</span>
            <Rating label="How did you sleep?" hint="" labels={SLEEP_LABELS} value={sleepQ} onChange={setSleepQ} />
            <div className="scan-hours">
              <span className="kicker">Hours slept</span>
              <div className="stepper scan-stepper">
                <button type="button" onClick={() => stepHours(-0.5)} aria-label="Half an hour less">−</button>
                <input className="input" inputMode="decimal" value={hours} placeholder="7.5" onChange={(e) => setHours(e.target.value)} aria-label="Hours slept" />
                <button type="button" onClick={() => stepHours(0.5)} aria-label="Half an hour more">+</button>
              </div>
              {hcSleep?.sleep_minutes != null && (
                <span className="small muted">
                  Health Connect: {hm(hcSleep.sleep_minutes)} asleep
                  {hcHours != null && String(hcHours) !== hours && <> · <button type="button" className="link small" onClick={() => setHours(String(hcHours))}>Use {hcHours} h</button></>}
                </span>
              )}
            </div>
          </div>
        )}

        {step === "body" && (
          <div className="scan-step">
            <span className="kicker">This morning</span>
            <Rating label="Energy" hint="" labels={ENERGY_LABELS} value={energy} onChange={(v) => { setEnergy(v); if (soreness != null) later(next); }} />
            <Rating label="Soreness" hint="5 means not sore at all" labels={SORENESS_LABELS} value={soreness} onChange={(v) => { setSoreness(v); if (energy != null) later(next); }} />
          </div>
        )}

        {step === "mood" && (
          <div className="scan-step">
            <span className="kicker">Optional</span>
            <Rating label="Mood" hint="" labels={MOOD_LABELS} value={mood} onChange={(v) => { setMood(v); later(next); }} />
          </div>
        )}

        {step === "head" && (
          <div className="scan-step">
            <span className="kicker">{HEADSPACE_NAME} · every 2 weeks · {gq + 1} of 7</span>
            <p className="small muted" style={{ margin: "2px 0 4px" }}>{GAD_INTRO}</p>
            <h1 className="scan-q">{GAD_ITEMS[gq]}</h1>
            <div className="scan-list" role="radiogroup" aria-label={GAD_ITEMS[gq]}>
              {GAD_OPTIONS.map((o, v) => <button key={v} role="radio" aria-checked={gad[gq] === v} className={gad[gq] === v ? "on" : ""} onClick={() => gadAnswer(v)}>{o}</button>)}
            </div>
            <div className="ticker scan-sub" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <span key={i} className={`tick${gad[i] != null ? " on" : ""}`} />)}</div>
            <button className="link scan-skip" onClick={() => { setGadSkip(true); setGad(Array(7).fill(null)); setGq(0); next(); }}>Skip the check-in today</button>
          </div>
        )}

        {step === "details" && (
          <div className="scan-step">
            <span className="kicker">Last details</span>
            <h1 className="scan-q">Anything else?</h1>
            <div className="panel scan-sum">
              <div>
                <span className="kicker">Calories</span>
                <b>{phase ? PHASE_LABEL[phase] : "Phase not set"}{kcal != null && !Number.isNaN(kcal) ? ` · ${kcal.toLocaleString("en-IE")} kcal` : ""}</b>
                <span className="small muted">{dayTarget != null && kcal === Math.round(dayTarget) ? "From your food target for today" : phase && prevPhase === phase ? "Same as your last scan" : "Used to decide how hard to push progression"}</span>
              </div>
              <button className="link small" onClick={() => setEditCal((e) => !e)}>{editCal ? "Done" : "Change"}</button>
            </div>
            {editCal && (
              <div className="panel" style={{ marginTop: -4 }}>
                <div className="seg" role="radiogroup" aria-label="Calories">
                  {(["deficit", "maintenance", "surplus"] as Phase[]).map((ph) => <button key={ph} role="radio" aria-checked={phase === ph} className={phase === ph ? "on" : ""} onClick={() => setPhase(ph)}>{PHASE_LABEL[ph]}</button>)}
                </div>
                <label className="field" style={{ marginTop: 10 }}><span>Daily calorie target</span><input className="input" inputMode="numeric" value={calories} placeholder="e.g. 2200" onChange={(e) => setCalories(e.target.value)} /></label>
              </div>
            )}
            <div className="panel scan-sum">
              <div>
                <span className="kicker">Weight</span>
                <b>{w != null && weightOk ? `${w} kg` : "Not logged"}</b>
                <span className="small muted">{w != null && weightOk && lastWeight != null ? `${w - lastWeight > 0 ? "+" : ""}${(Math.round((w - lastWeight) * 10) / 10).toFixed(1)} kg since last` : "Optional · same time each morning"}</span>
              </div>
              <button className="link small" onClick={() => setEditWeight((e) => !e)}>{editWeight ? "Done" : w != null ? "Edit" : "Add"}</button>
            </div>
            {editWeight && (
              <div className="panel" style={{ marginTop: -4 }}>
                <label className="field"><span>Current weight (kg)</span><input className="input" inputMode="decimal" value={weight} placeholder={lastWeight != null ? String(lastWeight) : "Morning weight"} onChange={(e) => setWeight(e.target.value)} autoFocus /></label>
              </div>
            )}
            <label className="field"><span>Notes (optional)</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Late night, niggle in left knee…" /></label>
          </div>
        )}

        {step === "result" && result && adj && (
          <div className="scan-step">
            <div className={`hero-card prog-hero band-${adj.band}`}>
              <Chevrons />
              <span className="hero-kicker">Today · saved</span>
              <span className="hero-name ready-hero">{BAND_LABEL[adj.band].toUpperCase()} · {result.score}</span>
              <span className="hero-facts"><span>{adj.headline}</span>{saved?.sick && <span>Unwell: {CHOICE_LABEL[sickChoice ?? "normal"].toLowerCase()}</span>}</span>
            </div>
            <div className="tiles">
              <div className="tile"><span className="tile-h">Sleep</span><span className="tile-v num">{h != null && !Number.isNaN(h) ? `${h} h` : "–"}</span><span className="tile-s small">quality {sleepQ} of 5</span></div>
              <div className="tile"><span className="tile-h">vs your average</span><span className="tile-v num">{avg28 != null ? `${result.score - avg28 >= 0 ? "+" : ""}${result.score - avg28}` : "–"}</span><span className="tile-s small">{avg28 != null ? `28-day avg ${avg28}` : "first scans"}</span></div>
            </div>
            {[...result.notes, ...adj.reasons].length > 0 && (
              <ul className="panel scan-reasons">{[...result.notes, ...adj.reasons].map((n, i) => <li key={i} className="small">{n}</li>)}</ul>
            )}
          </div>
        )}

        {error && <p className="error panel" role="alert">{error}</p>}
        <div className="scan-foot">
          {step === "feel" && <button className="btn primary block" disabled={!feelOk} onClick={next}>Next</button>}
          {step === "sleep" && <button className="btn primary block" disabled={sleepQ == null || !hoursOk} onClick={next}>Next</button>}
          {step === "body" && <button className="btn primary block" disabled={energy == null || soreness == null} onClick={next}>Next</button>}
          {step === "mood" && <button className={`btn block ${mood == null ? "ghost" : "primary"}`} onClick={next}>{mood == null ? "Skip" : "Next"}</button>}
          {step === "details" && <button className="btn primary block" disabled={busy || !complete} onClick={() => save(true)}>{busy ? "Saving…" : "See today's readiness"}</button>}
          {step === "result" && saved && <button className="btn primary block" onClick={() => onSaved(saved)}>{saveLabel === "Save scan" ? "Back to dashboard" : saveLabel.replace(/^Save and /, "").replace(/^./, (c) => c.toUpperCase())}</button>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Readiness scan</h1>
          <p className="muted small">{existing ? `${formatDay(new Date(existing.checked_at))}, ${formatTime(new Date(existing.checked_at))}` : "20 seconds. It only changes today's suggestions."}</p>
        </div>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>

      <section className={`panel sick-panel${unwell ? " on" : ""}`} aria-labelledby="feel-h">
        <div className="rating-head">
          <h3 id="feel-h">{prevSick ? "Still unwell?" : "How are you feeling?"}</h3>
          {prevSick && <span className="muted small">Carried over from {formatDay(new Date(prevSick.checked_at))}</span>}
        </div>
        <div className="seg" role="radiogroup" aria-labelledby="feel-h">
          <button role="radio" aria-checked={!unwell} className={!unwell ? "on" : ""} onClick={() => setUnwell(false)}>{prevSick ? "I'm better" : "I'm well"}</button>
          <button role="radio" aria-checked={unwell} className={unwell ? "on" : ""} onClick={() => setUnwell(true)}>{prevSick ? "Still unwell" : "I'm unwell"}</button>
        </div>
        {unwell && (
          <>
            <p className="small muted" style={{ margin: "10px 0 6px" }}>Symptoms</p>
            <div className="sym-groups">
              <div>
                <span className="sym-h small">Above the neck</span>
                <div className="chips">{SYMPTOMS.filter((s) => s.above).map((s) => <button key={s.id} type="button" className={`chip-btn${symptoms.includes(s.id) ? " on" : ""}`} aria-pressed={symptoms.includes(s.id)} onClick={() => toggleSymptom(s.id)}>{s.label}</button>)}</div>
              </div>
              <div>
                <span className="sym-h small">Below the neck or all over</span>
                <div className="chips">{SYMPTOMS.filter((s) => !s.above).map((s) => <button key={s.id} type="button" className={`chip-btn bad${symptoms.includes(s.id) ? " on" : ""}`} aria-pressed={symptoms.includes(s.id)} onClick={() => toggleSymptom(s.id)}>{s.label}</button>)}</div>
              </div>
            </div>
            {symptoms.length > 0 && (forcedRest ? (
              <div className="sick-verdict rest">
                <strong>Rest today.</strong> With symptoms below the neck{symptoms.includes("fever") ? " or a fever" : ""}, training makes things worse, not better. Today's strength session is skipped (the program waits for you) and planned cardio is cleared.
                {symptoms.includes("fever") && " Once you're better, you'll get a full day clear of fever before lifting again."}
              </div>
            ) : (
              <>
                <p className="small" style={{ margin: "10px 0 6px" }}>Above the neck only, so light training is usually fine. What would you like to do today?</p>
                <div className="seg" role="radiogroup" aria-label="Today's session">
                  {(["normal", "light", "rest"] as SickChoice[]).map((c) => <button key={c} role="radio" aria-checked={choice === c} className={choice === c ? "on" : ""} onClick={() => setChoice(c)}>{CHOICE_LABEL[c]}</button>)}
                </div>
                {choice && <p className="small muted" style={{ marginTop: 6 }}>
                  {choice === "normal" && "Full session as planned. The day is marked as unwell, so a dip doesn't count against your progress."}
                  {choice === "light" && "About half the sets, a little lighter, stopping by RPE 7. It doesn't count towards progression. Keep any cardio easy and short."}
                  {choice === "rest" && "Today's session is skipped (the program waits) and planned cardio is cleared. Your first session back will be an easy one."}
                </p>}
              </>
            ))}
            <p className="small muted sick-flags">See a doctor if you have chest pain, trouble breathing, or a fever that lasts more than a few days.</p>
          </>
        )}
      </section>

      <div className="stack">
        <Rating label="Sleep quality" hint="How well did you sleep?" labels={SLEEP_LABELS} value={sleepQ} onChange={setSleepQ} />
        <Rating label="Energy" hint="How fresh do you feel?" labels={ENERGY_LABELS} value={energy} onChange={setEnergy} />
        <Rating label="Soreness" hint="5 means not sore at all" labels={SORENESS_LABELS} value={soreness} onChange={setSoreness} />
        <Rating label="Mood" hint="Optional" labels={MOOD_LABELS} value={mood} onChange={setMood} onClear={() => setMood(null)} />
      </div>

      {gadAsk && (
        <section className="panel gad-panel" aria-labelledby="gad-h" style={{ marginTop: 12 }}>
          <div className="rating-head">
            <h3 id="gad-h">{HEADSPACE_NAME} check-in</h3>
            <span className="muted small">{gadDone ? `${gadScore(gad as number[])} · ${gadBand(gadScore(gad as number[]))}` : gadSkip ? "Skipped" : "Every 2 weeks"}</span>
          </div>
          {gadSkip ? (
            <p className="small muted" style={{ margin: 0 }}>Skipped for today. <button className="link small" onClick={() => setGadSkip(false)}>Answer it now</button></p>
          ) : (
            <>
              <p className="small muted" style={{ margin: "0 0 8px" }}>{GAD_INTRO}</p>
              <ol className="gad-list">
                {GAD_ITEMS.map((q, i) => (
                  <li key={i}>
                    <span className="small">{q}</span>
                    <div className="seg gad-seg" role="radiogroup" aria-label={q}>
                      {GAD_OPTIONS.map((o, v) => <button key={v} role="radio" aria-checked={gad[i] === v} className={gad[i] === v ? "on" : ""} onClick={() => setGad((g) => g.map((x, j) => (j === i ? v : x)))}>{o}</button>)}
                    </div>
                  </li>
                ))}
              </ol>
              {!existing && <button className="link small" onClick={() => { setGadSkip(true); setGad(Array(7).fill(null)); }}>Skip for today</button>}
            </>
          )}
        </section>
      )}

      <div className="grid c2" style={{ marginTop: 12 }}>
        <div className="panel">
          <label className="field">
            <span>Hours slept</span>
            <div className="stepper">
              <button type="button" onClick={() => stepHours(-0.5)} aria-label="Half an hour less">−</button>
              <input className="input" inputMode="decimal" value={hours} placeholder="7.5" onChange={(e) => setHours(e.target.value)} />
              <button type="button" onClick={() => stepHours(0.5)} aria-label="Half an hour more">+</button>
            </div>
          </label>
          {hcSleep?.sleep_minutes != null && (
            <p className="muted small" style={{ marginTop: 6 }}>
              Health Connect: {hm(hcSleep.sleep_minutes)} asleep{hcSleep.deep_minutes != null && hcSleep.rem_minutes != null ? ` (deep ${hm(hcSleep.deep_minutes)}, REM ${hm(hcSleep.rem_minutes)})` : ""}
              {hcHours != null && String(hcHours) !== hours && <> · <button type="button" className="link small" onClick={() => setHours(String(hcHours))}>Use {hcHours} h</button></>}
            </p>
          )}
        </div>
        <div className="panel">
          <label className="field">
            <span>Current weight (kg)</span>
            <input className="input" inputMode="decimal" value={weight} placeholder={lastWeight != null ? String(lastWeight) : "Morning weight"} onChange={(e) => setWeight(e.target.value)} />
          </label>
          <p className="muted small" style={{ marginTop: 6 }}>
            {w != null && weightOk && lastWeight != null
              ? `${w - lastWeight > 0 ? "+" : ""}${(Math.round((w - lastWeight) * 10) / 10).toFixed(1)} kg since last`
              : "Optional. Same time each morning."}
            {rate != null && <>{". "}{rate >= 0 ? `Losing ${rate.toFixed(1)}%` : `Gaining ${Math.abs(rate).toFixed(1)}%`} a week</>}
            {dayWeight != null && w === dayWeight && existing?.bodyweight_kg == null && ". From today's weigh-in"}
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="rating-head">
          <h3 id="phase-h">Calories</h3>
          <span className="muted small">{phase ? (prevPhase === phase && !existing ? "Same as your last scan" : `Aim to ${PHASE_RATE[phase].text}`) : "Which phase are you in?"}</span>
        </div>
        <div className="seg" role="radiogroup" aria-labelledby="phase-h">
          {(["deficit", "maintenance", "surplus"] as Phase[]).map((p) => (
            <button key={p} role="radio" aria-checked={phase === p} className={phase === p ? "on" : ""} onClick={() => setPhase(p)}>{PHASE_LABEL[p]}</button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span>Daily calorie target{dayTarget == null ? " (optional)" : ""}</span>
          <input className="input" inputMode="numeric" value={calories} placeholder="e.g. 2200" onChange={(e) => setCalories(e.target.value)} />
        </label>
        {dayTarget != null && kcal === Math.round(dayTarget) && <p className="muted small" style={{ marginTop: 6 }}>From your food target for the day.</p>}
        <p className="muted small" style={{ marginTop: 6 }}>
          {phase === "deficit" && "The coach holds weight and trims volume when lifts stall, so you keep muscle while losing fat."}
          {phase === "maintenance" && "Normal progression, with each template's stall rule."}
          {phase === "surplus" && "The coach progresses more readily and adds volume when lifts stall, since you can recover from more."}
          {!phase && "Used by the coach to decide how hard to push progression."}
        </p>
      </div>

      {result && adj ? (
        <section className={`ready-card band-${bandFor(result.score)}`} aria-live="polite">
          <div className="ready-top">
            <span className="ready-score">{result.score}</span>
            <span>
              <strong className="ready-band">{BAND_LABEL[adj.band]}</strong>
              <span className="ready-head">{adj.headline}</span>
            </span>
          </div>
          <ul className="ready-parts">
            {result.parts.map((p, i) => (
              <li key={i}><span>{p.label}</span><span className="num">{i === 0 ? p.value : `${p.value > 0 ? "+" : ""}${p.value}`}</span></li>
            ))}
          </ul>
          {[...result.notes, ...adj.reasons].map((n, i) => <p key={i} className="small" style={{ marginTop: 6 }}>{n}</p>)}
        </section>
      ) : (
        <p className="muted small" style={{ marginTop: 14 }}>Rate all three to see today's readiness and what it changes.</p>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        <span>Notes (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Late night, stressful day, niggle in left knee…" />
      </label>

      <div className="save-bar static" style={{ marginTop: 16 }}>
        {error && <p className="error panel" role="alert">{error}</p>}
        <button className="btn dark block" onClick={() => save()} disabled={busy || !complete}>{busy ? "Saving…" : saveLabel}</button>
        {onSkip && <button className="btn ghost block" onClick={onSkip}>Skip scan, use the plan as written</button>}
      </div>

      {existing && onDeleted && (
        <button className="btn danger block" style={{ marginTop: 24 }} onClick={remove} disabled={busy}>
          {confirmDelete ? "Tap again to delete this scan" : "Delete scan"}
        </button>
      )}
    </>
  );
}
