import { useState } from "react";
import type { AppData } from "../App";
import { STATUS_LABEL, STATUS_TONE, coachOverview, deloadActive } from "../lib/coach";
import { adjustmentFor, latestPhase, todaysCheckin } from "../lib/readiness";
import { saveSettings } from "../lib/data";
import { fmtKg } from "../lib/strength";

const DAY = 86400000;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CoachPanel({ data, onOpenExercise, onChanged }: { data: AppData; onOpenExercise: (id: string) => void; onChanged: () => void }) {
  const { exercises, workouts, templates, settings, checkins } = data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deload = deloadActive(settings.deload_until);
  const today = todaysCheckin(checkins);
  const week = checkins.filter((c) => Date.now() - new Date(c.checked_at).getTime() < 7 * DAY);
  const readiness7 = week.length ? week.reduce((a, c) => a + c.score, 0) / week.length : null;
  const ov = coachOverview(exercises, workouts, templates, {
    formula: settings.e1rm_formula, inc: settings.weight_increment, adj: today ? adjustmentFor(today) : null, deload, readiness7, phase: latestPhase(checkins),
  });
  const names = new Map(exercises.map((e) => [e.id, e.name]));

  async function setDeload(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const until = on ? ymd(new Date(Date.now() + 6 * DAY)) : null;
      await saveSettings({ ...settings, deload_until: until });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  if (!ov.lifts.length && !deload) return null;
  const order = { bad: 0, warn: 1, neutral: 2, good: 3 } as const;
  const lifts = [...ov.lifts].sort((a, b) => order[STATUS_TONE[a.status]] - order[STATUS_TONE[b.status]] || (names.get(a.exerciseId) ?? "").localeCompare(names.get(b.exerciseId) ?? ""));

  return (
    <section className="section">
      <h2>Coach</h2>
      {deload ? (
        <div className="coach-alert tone-warn">
          <p><strong>Deload week until {new Date(settings.deload_until + "T12:00:00").toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}.</strong> Loads −10%, half the sets, RPE 7 max. Strength usually comes back above where it was the week after.</p>
          <button className="link small" onClick={() => setDeload(false)} disabled={busy}>End deload now</button>
        </div>
      ) : ov.deloadAdvised ? (
        <div className="coach-alert tone-bad">
          <p><strong>Deload recommended.</strong> {ov.deloadReason} One lighter week clears fatigue that's hiding your strength, which matters more in a deficit.</p>
          <button className="btn primary" onClick={() => setDeload(true)} disabled={busy}>Start a deload week</button>
        </div>
      ) : ov.slipping.length === 1 ? (
        <div className="coach-alert tone-warn">
          <p><strong>{names.get(ov.slipping[0].exerciseId)} is slipping.</strong> The coach has switched it to Preserve muscle: same weight, match your reps, one fewer set. If a second lift slips, it'll suggest a deload.</p>
        </div>
      ) : null}
      {error && <p className="error">{error}</p>}

      <div className="panel list-panel" style={{ marginTop: 8 }}>
        {lifts.map((p) => {
          const vs = p.history.vsPeakPct;
          return (
            <button key={p.exerciseId} className="list-row" onClick={() => onOpenExercise(p.exerciseId)}>
              <span style={{ minWidth: 0 }}>
                <strong>{names.get(p.exerciseId) ?? "Exercise"}</strong>
                <span className="small" style={{ display: "block" }}>
                  <span className={`coach-chip tone-${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span> {p.headline}
                </span>
              </span>
              <span className="row-v num" title="Latest session's estimated 1RM against its 6-week best">
                {p.history.latest != null ? fmtKg(Math.round(p.history.latest)) : "–"}<span className="muted small"> kg</span>
                {vs != null && p.history.sessions.length > 1 && (
                  <span className={`small ${vs < -4 ? "delta down" : vs >= -0.5 ? "delta up" : "muted"}`} style={{ display: "block", marginLeft: 0 }}>
                    {vs >= -0.5 ? "at peak" : `${Math.round(vs)}% vs peak`}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>Next session's prescription for each lift you've trained in the last 6 weeks, and its estimated 1RM against its 6-week best.</p>
    </section>
  );
}
