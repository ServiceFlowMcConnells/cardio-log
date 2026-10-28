import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData } from "../App";
import type { Area, Routine } from "../lib/mobility";
import { AREA_LABEL, dailyRoutine, doseText, fmtMin, mobilityCtx, preWorkout, templateDemand } from "../lib/mobility";
import { saveMobilitySession } from "../lib/mobilityData";

interface Props {
  data: AppData;
  kind: "daily" | "prewarm";
  templateId: string | null;
  doneLabel: string;
  onClose: () => void;
  onDone: () => void;
  onNiggles: () => void;
}

type Fb = "better" | "same" | "worse";
const READY_SEC = 5;

function buzz(ms: number | number[]) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

export function buildRoutine(data: AppData, kind: "daily" | "prewarm", templateId: string | null): Routine | null {
  const ctx = mobilityCtx(data);
  if (kind === "prewarm") {
    const t = data.templates.find((x) => x.id === templateId);
    return t ? preWorkout(ctx, t, data.exercises) : null;
  }
  // Daily routines lean towards what your next workout needs
  const lastDone = (id: string) => data.workouts.find((w) => w.template_id === id)?.started_at ?? "";
  const next = [...data.templates].sort((a, b) => lastDone(a.id).localeCompare(lastDone(b.id)) || a.position - b.position)[0] ?? null;
  const demand = templateDemand(next, data.exercises);
  for (const k of Object.keys(demand) as Area[]) demand[k] = demand[k]! * 0.5;
  return dailyRoutine(ctx, demand);
}

export default function MobilityPlayer({ data, kind, templateId, doneLabel, onClose, onDone, onNiggles }: Props) {
  const routine = useMemo(() => buildRoutine(data, kind, templateId), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(-1); // -1 = overview
  const [side, setSide] = useState(0);
  const [phase, setPhase] = useState<"ready" | "work" | "paused">("ready");
  const [endAt, setEndAt] = useState<number | null>(null);
  const [pausedLeft, setPausedLeft] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [fb, setFb] = useState<Partial<Record<Area, Fb>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const tpl = data.templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Keep the screen on during the routine where supported
  useEffect(() => {
    if (idx < 0 || finished) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [idx < 0, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = routine?.items ?? [];
  const cur = idx >= 0 ? items[idx] : null;
  const d = cur?.drill;
  const sides = d?.sides ? 2 : 1;
  const left = endAt != null ? Math.max(0, Math.ceil((endAt - now) / 1000)) : pausedLeft;

  function finish(n: number) {
    setEndAt(null);
    setDoneCount(n);
    setFinished(true);
  }

  function begin(i: number, s = 0) {
    setIdx(i);
    setSide(s);
    setPhase("ready");
    setPausedLeft(null);
    setEndAt(Date.now() + READY_SEC * 1000);
  }

  function advance() {
    if (!d) return;
    if (side + 1 < sides) {
      buzz(120);
      setSide(side + 1);
      setPausedLeft(null);
      // Timed drills get a few seconds to switch sides
      setPhase(d.sec ? "ready" : "work");
      setEndAt(d.sec ? Date.now() + READY_SEC * 1000 : null);
      return;
    }
    if (idx + 1 < items.length) {
      buzz([80, 60, 80]);
      begin(idx + 1);
    } else {
      buzz([120, 80, 120]);
      finish(items.length);
    }
  }

  // Timer transitions
  useEffect(() => {
    if (endAt == null || now < endAt || !d) return;
    if (phase === "ready") {
      buzz(60);
      setPhase("work");
      setEndAt(d.sec ? Date.now() + d.sec * 1000 : null);
    } else if (phase === "work" && d.sec) {
      advance();
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePause() {
    if (phase === "paused") {
      setPhase("work");
      setEndAt(pausedLeft != null ? Date.now() + pausedLeft * 1000 : null);
      setPausedLeft(null);
    } else {
      setPausedLeft(left ?? null);
      setEndAt(null);
      setPhase("paused");
    }
  }

  const areas = useMemo(() => {
    const a: Area[] = [];
    for (const it of items.slice(0, doneCount)) if (it.phase !== "raise" && !a.includes(it.area)) a.push(it.area);
    return a;
  }, [items, doneCount]);

  async function save(thenNiggles = false) {
    if (!routine) return;
    setBusy(true);
    setError(null);
    try {
      const done = items.slice(0, doneCount);
      await saveMobilitySession({
        kind,
        template_id: kind === "prewarm" ? templateId : null,
        duration_sec: Math.round((Date.now() - startedAt.current) / 1000),
        drills: done.map((it) => ({ id: it.drill.id, area: it.area, level: it.drill.level })),
        feedback: fb,
      });
      if (thenNiggles) onNiggles(); else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }

  if (!routine || !items.length) {
    return (
      <div className="empty">
        <p>{kind === "prewarm" ? "There's nothing safe to warm up for that workout with your current niggles. Check them, or go straight to your warm-up sets." : "No drills could be built from your current niggles. Review them first."}</p>
        <button className="btn primary" onClick={onNiggles}>Review niggles</button>
        <button className="btn ghost" style={{ marginLeft: 8 }} onClick={onClose}>Back</button>
      </div>
    );
  }

  // Overview
  if (idx < 0) {
    return (
      <>
        <div className="editor-bar">
          <div>
            <h1>{kind === "prewarm" ? `Warm-up: ${tpl?.name ?? "workout"}` : "Today's mobility"}</h1>
            <p className="muted small">{items.length} drills, about {fmtMin(routine.seconds)}. Bodyweight only, a mat helps.</p>
          </div>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {routine.focus.length > 0 && (
          <div className="panel mob-focus">
            <h3>{kind === "prewarm" ? "Prepping" : "Focus today"}</h3>
            {routine.focus.slice(0, 4).map((s) => (
              <p key={s.area} className="small"><strong>{AREA_LABEL[s.area]}</strong> <span className="muted">{s.reasons.length ? s.reasons.join(", ") : "general upkeep"}</span></p>
            ))}
          </div>
        )}
        {routine.note && <div className="coach-alert tone-warn" style={{ marginTop: 10 }}><p>{routine.note}</p></div>}
        <ol className="mob-list">
          {items.map((it, i) => (
            <li key={it.drill.id}>
              <span className="mob-n">{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{it.drill.name}</strong>
                <span className="small muted" style={{ display: "block" }}>{doseText(it.drill)} · {it.phase === "raise" ? "Raise" : AREA_LABEL[it.area]}</span>
              </span>
              <span className={`chip mob-lv lv${it.drill.level}`} title="Difficulty">L{it.drill.level}</span>
            </li>
          ))}
        </ol>
        {kind === "prewarm" && <p className="muted small" style={{ marginTop: 8 }}>Built on the RAMP warm-up: raise your temperature, then move the joints this workout loads through their range with dynamic drills (no long static holds, which can sap strength right before lifting). Your warm-up sets do the rest.</p>}
        <div className="save-bar">
          <button className="btn primary block" onClick={() => { startedAt.current = Date.now(); begin(0); }}>Start</button>
        </div>
      </>
    );
  }

  // Feedback
  if (finished) {
    return (
      <>
        <div className="editor-bar">
          <div>
            <h1>Done</h1>
            <p className="muted small">{doneCount} of {items.length} drills in {fmtMin((Date.now() - startedAt.current) / 1000)}.</p>
          </div>
        </div>
        {doneCount > 0 ? <p className="small">How did each area feel compared with last time? This moves your drills up or down a level.</p> : <p className="small">No drills finished, so there's nothing to save.</p>}
        <div className="stack" style={{ marginTop: 10 }}>
          {areas.map((a) => (
            <div key={a} className="mob-fb">
              <span><strong>{AREA_LABEL[a]}</strong></span>
              <div className="seg" role="group" aria-label={`${AREA_LABEL[a]} feedback`}>
                {(["worse", "same", "better"] as Fb[]).map((v) => (
                  <button key={v} className={(fb[a] ?? "same") === v ? "on" : ""} aria-pressed={(fb[a] ?? "same") === v} onClick={() => setFb((f) => ({ ...f, [a]: v }))}>
                    {v === "worse" ? "Worse" : v === "same" ? "Same" : "Better"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Anything sharp, or numbness or tingling? <button className="link small" onClick={() => save(true)} disabled={busy}>Save and log a niggle</button> and those drills will be rested.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="save-bar">
          {doneCount > 0
            ? <button className="btn primary block" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : doneLabel}</button>
            : <button className="btn ghost block" onClick={onClose}>Close without saving</button>}
        </div>
      </>
    );
  }

  // Player
  const total = items.length;
  const pct = ((idx + (side + 1) / (sides + 1)) / total) * 100;
  const timed = Boolean(d?.sec);
  const ringMax = phase === "ready" ? READY_SEC : d?.sec ?? 1;
  const ringLeft = left ?? ringMax;
  return (
    <>
      <div className="editor-bar">
        <span className="muted small">Drill {idx + 1} of {total}{cur?.phase === "raise" ? " · Raise" : ""}</span>
        <button className="btn ghost" onClick={() => finish(idx)}>End</button>
      </div>
      <div className="mob-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>

      <section className="mob-player">
        <p className="mob-area">{cur?.phase === "raise" ? "Raise" : AREA_LABEL[cur!.area]}</p>
        <h1>{d!.name}</h1>
        {sides > 1 && <p className="mob-side">{side === 0 ? "First side" : "Second side"}</p>}

        <div className={`mob-clock${phase === "ready" ? " ready" : ""}`} role="timer" aria-live="polite">
          {phase === "ready" ? (
            <>
              <span className="mob-big">{ringLeft}</span>
              <span className="small">Get into position</span>
            </>
          ) : timed ? (
            <>
              <span className="mob-big">{ringLeft}</span>
              <span className="small">{phase === "paused" ? "Paused" : "seconds"}</span>
            </>
          ) : (
            <>
              <span className="mob-big">{d!.reps}</span>
              <span className="small">reps{sides > 1 ? " this side" : ""}, slow and controlled</span>
            </>
          )}
          {(phase === "ready" || timed) && (
            <span className="mob-bar"><span style={{ width: `${Math.max(0, Math.min(100, (ringLeft / ringMax) * 100))}%` }} /></span>
          )}
        </div>

        <p className="mob-how">{d!.how}</p>
        <p className="small muted"><strong>Feel it:</strong> {d!.feel} Stop if it's sharp.</p>
      </section>

      <div className="save-bar mob-controls">
        <button className="btn ghost" onClick={() => (side > 0 ? begin(idx, 0) : idx > 0 ? begin(idx - 1) : begin(0))} aria-label="Previous">‹ Back</button>
        {phase === "ready" ? (
          <button className="btn primary" onClick={() => { setPhase("work"); setEndAt(d!.sec ? Date.now() + d!.sec * 1000 : null); }}>Go now</button>
        ) : timed ? (
          <button className="btn primary" onClick={togglePause}>{phase === "paused" ? "Resume" : "Pause"}</button>
        ) : (
          <button className="btn primary" onClick={advance}>{side + 1 < sides ? "Next side" : idx + 1 < total ? "Done, next" : "Finish"}</button>
        )}
        <button className="btn ghost" onClick={() => (idx + 1 < total ? begin(idx + 1) : finish(total))} aria-label="Skip">Skip ›</button>
      </div>
    </>
  );
}
