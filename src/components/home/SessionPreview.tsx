import { useState } from "react";
import type { AppData } from "../../App";
import type { Template } from "../../lib/strength";
import { MUSCLE_LABEL } from "../../lib/strength";
import { STATUS_LABEL, STATUS_TONE, coachExercise, deloadActive } from "../../lib/coach";
import { adjustmentFor, latestPhase, lowReadinessCount, todaysCheckin } from "../../lib/readiness";
import { plannedTemplate, ymd } from "../../lib/schedule";
import { useDesktop } from "../../lib/desktop";
import type { Tweaks } from "../../lib/tweaks";
import { NO_TWEAKS, applyTweaks, estimateMinutes, hasTweaks, loadTweaks, saveTweaks } from "../../lib/tweaks";
import ExercisePicker from "../ExercisePicker";
import type { HeroSession } from "./Home";

/** The session before you start it: each exercise with the coach's target, and tweaks for this day only. */
export default function SessionPreview({ data, hero, onStart, onClose, onCreatedExercise }: {
  data: AppData; hero: HeroSession; onStart: (t: Template) => void; onClose: () => void; onCreatedExercise: () => void;
}) {
  const desktop = useDesktop();
  const base = plannedTemplate(hero.template, data.planned, hero.date);
  const [tw, setTw] = useState<Tweaks>(() => loadTweaks(hero.date, hero.template.id));
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const update = (f: (t: Tweaks) => Tweaks) => setTw((cur) => { const n = f(cur); saveTweaks(hero.date, hero.template.id, n); return n; });
  const t = applyTweaks(base, tw);
  const { exercises, workouts, templates, settings, checkins } = data;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const isToday = hero.date === ymd(new Date());
  const scan = todaysCheckin(checkins);
  const opts = { formula: settings.e1rm_formula, inc: settings.weight_increment, adj: isToday && scan ? adjustmentFor(scan) : null, deload: deloadActive(settings.deload_until), phase: latestPhase(checkins), lowRun: lowReadinessCount(checkins) };
  const nowIso = new Date().toISOString();
  const reps = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
  const rest = (s: number | null) => { const v = s ?? settings.default_rest_sec; return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };

  if (swapFor) {
    return (
      <ExercisePicker
        exercises={exercises}
        title="Swap for"
        onClose={() => setSwapFor(null)}
        onCreated={onCreatedExercise}
        onPick={(ids) => {
          const id = ids[0];
          if (id) update((c) => {
            const swaps = { ...c.swaps };
            if (id === swapFor) delete swaps[swapFor]; else swaps[swapFor] = id;
            return { ...c, swaps };
          });
          setSwapFor(null);
        }}
      />
    );
  }

  return (
    <div className="preview">
      <div className="preview-head">
        <button className="icon-btn" onClick={onClose} aria-label={desktop ? "Close" : "Back"}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{desktop ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M15 5l-7 7 7 7" />}</svg>
        </button>
        <div style={{ minWidth: 0 }}>
          <span className="kicker">{hero.label}{hero.sub ? ` · ${hero.sub}` : ""}</span>
          <h1 className="preview-name">{t.name.toUpperCase()}</h1>
          <span className="small muted">≈ {estimateMinutes(t, settings.default_rest_sec)} min · {t.exercises.length} exercises · {t.exercises.reduce((a, x) => a + x.sets, 0)} sets</span>
        </div>
      </div>

      <ol className="preview-list">
        {t.exercises.map((te, i) => {
          const orig = base.exercises[i];
          const swapped = tw.swaps[orig.exercise_id];
          const ex = exMap.get(te.exercise_id);
          const pr = coachExercise(ex, te.exercise_id,
            { sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, target_rpe: te.target_rpe, progression: te.progression, on_stall: te.on_stall, increment_kg: te.increment_kg },
            workouts, templates, nowIso, opts);
          const delta = tw.sets[orig.exercise_id] ?? 0;
          const setDelta = (d: number) => update((c) => {
            const v = (c.sets[orig.exercise_id] ?? 0) + d;
            const sets = { ...c.sets };
            if (v === 0) delete sets[orig.exercise_id]; else sets[orig.exercise_id] = v;
            return { ...c, sets };
          });
          return (
            <li key={i} className="pv-row">
              <div className="pv-row-main">
                <span><strong>{ex?.name ?? "Exercise"}</strong>{ex && <span className="small muted"> · {MUSCLE_LABEL[ex.muscle]}</span>}</span>
                {swapped && <span className="small pv-swapped">Swapped from {exMap.get(orig.exercise_id)?.name ?? "the plan"}</span>}
                <span className="pv-target">
                  {pr?.weight != null ? pr.headline : `${te.sets} × ${reps(te.rep_min, te.rep_max)}${te.target_rpe != null ? ` @ RPE ${te.target_rpe}` : ""}`}
                  {pr && pr.status !== "build_reps" && pr.status !== "new" && <span className={`coach-chip tone-${STATUS_TONE[pr.status]}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[pr.status]}</span>}
                </span>
                <span className="small muted">Reps {reps(te.rep_min, te.rep_max)} · RPE {te.target_rpe ?? "–"} · rest {rest(te.rest_sec)}</span>
              </div>
              {!desktop && <div className="pv-row-ctl">
                <span className="bd-sets">
                  <button className="icon-btn" disabled={te.sets <= 1} aria-label={`One set fewer of ${ex?.name ?? "this exercise"} today`} onClick={() => setDelta(-1)}>−</button>
                  <span className="num">{te.sets}</span>
                  <button className="icon-btn" disabled={te.sets >= 10} aria-label={`One more set of ${ex?.name ?? "this exercise"} today`} onClick={() => setDelta(1)}>+</button>
                </span>
                {delta !== 0 && <span className="small pv-delta">{delta > 0 ? `+${delta}` : delta} set{Math.abs(delta) === 1 ? "" : "s"}</span>}
                <button className="link small" onClick={() => setSwapFor(orig.exercise_id)}>{swapped ? "Change swap" : "Swap"}</button>
                {swapped && <button className="link small" onClick={() => update((c) => { const swaps = { ...c.swaps }; delete swaps[orig.exercise_id]; return { ...c, swaps }; })}>Undo swap</button>}
              </div>}
            </li>
          );
        })}
      </ol>

      {hasTweaks(tw) && (
        <p className="small muted preview-note">
          Tweaked for {isToday ? "today" : "that day"} only. Your template and week plan stay as they are. <button className="link small" onClick={() => update(() => NO_TWEAKS)}>Reset</button>
        </p>
      )}

      <div className="preview-foot">
        {desktop ? (
          <p className="small muted" style={{ margin: 0 }}>Tweak and start it from your phone.</p>
        ) : isToday ? (
          <>
            <span className="small muted">{scan ? "Loads adjusted for today's readiness" : "A readiness scan runs first"}</span>
            <button className="btn primary block" onClick={() => onStart(t)}>Start</button>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Planned for {new Date(hero.date + "T12:00:00").toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" })}. You can start it on the day.</p>
        )}
      </div>
    </div>
  );
}
