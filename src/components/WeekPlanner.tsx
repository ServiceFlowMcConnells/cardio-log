import { useMemo, useState } from "react";
import type { AppData } from "../App";
import type { Template } from "../lib/strength";
import { MUSCLE_LABEL } from "../lib/strength";
import { latestPhase } from "../lib/readiness";
import { nextInProgram } from "../lib/programs";
import type { Muscle } from "../lib/strength";
import { applyChanges, fromYmd, nextDays, planAdvice, savePlan, sessionTotalsAfter, setTarget, suggestDays, volumeSuggestions, ymd, SESSION_TOTAL_CAP } from "../lib/schedule";
import { saveTemplate } from "../lib/strengthData";

interface Props {
  data: AppData;
  onClose: () => void;
  onSaved: () => void;
  onRefresh: () => Promise<void>;
}

type Row = { template_id: string | null; manual: boolean };

function dayLabel(date: string, i: number) {
  const d = fromYmd(date);
  const wk = d.toLocaleDateString("en-IE", { weekday: "short" });
  const dm = d.toLocaleDateString("en-IE", { day: "numeric", month: "short" });
  return { top: i === 0 ? "Today" : i === 1 ? "Tomorrow" : wk, sub: i < 2 ? `${wk} ${dm}` : dm };
}

export default function WeekPlanner({ data, onClose, onSaved, onRefresh }: Props) {
  const { templates, exercises, programs, activeProgramId, workouts } = data;
  const dates = useMemo(() => nextDays(7), []);
  const active = programs.find((p) => p.id === activeProgramId) ?? null;

  // The order workouts get filled in: the active program's rotation from its next step, else longest-without first
  const cycle: Template[] = useMemo(() => {
    if (active) {
      const n = nextInProgram(active, templates);
      const steps = active.steps.map((id) => templates.find((t) => t.id === id)).filter((t): t is Template => Boolean(t));
      if (n && steps.length) {
        const start = active.steps.slice(0, n.index).filter((id) => templates.some((t) => t.id === id)).length;
        return [...steps.slice(start), ...steps.slice(0, start)];
      }
    }
    const last = (t: Template) => workouts.find((w) => w.template_id === t.id)?.started_at ?? "";
    return [...templates].sort((a, b) => last(a).localeCompare(last(b)) || a.position - b.position);
  }, [active, templates, workouts]);

  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const r: Record<string, Row> = {};
    for (const d of dates) {
      const p = data.planned.find((x) => x.planned_on === d && templates.some((t) => t.id === x.template_id));
      r[d] = { template_id: p?.template_id ?? null, manual: Boolean(p) };
    }
    return r;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Fill non-manual training days from the rotation, in date order. */
  const fill = (r: Record<string, Row>) => {
    const out = { ...r };
    let i = 0;
    for (const d of dates) {
      if (!out[d].template_id) continue;
      if (!out[d].manual && cycle.length) out[d] = { ...out[d], template_id: cycle[i % cycle.length].id };
      i++;
    }
    return out;
  };

  const toggle = (d: string) => setRows((r) => fill({ ...r, [d]: r[d].template_id ? { template_id: null, manual: false } : { template_id: cycle[0]?.id ?? null, manual: false } }));
  const pick = (d: string, id: string) => setRows((r) => (id === "" ? fill({ ...r, [d]: { template_id: null, manual: false } }) : { ...r, [d]: { template_id: id, manual: true } }));
  const quick = (n: number) => {
    const chosen = new Set(suggestDays(n, dates));
    setRows(() => fill(Object.fromEntries(dates.map((d) => [d, { template_id: chosen.has(d) ? cycle[0]?.id ?? null : null, manual: false }]))));
  };

  const plan = dates.map((d) => ({ date: d, template: templates.find((t) => t.id === rows[d].template_id) ?? null }));
  const phase = latestPhase(data.checkins);
  const advice = planAdvice(plan, exercises, phase);
  // Every major muscle (even at zero), plus arms/calves when they're trained
  const MAJORS: Muscle[] = ["chest", "back", "shoulders", "quads", "hamstrings", "glutes"];
  const shown = advice.sessions === 0 ? [] : [
    ...MAJORS.map((m) => advice.muscles.find((x) => x.muscle === m) ?? { muscle: m, sessions: 0, sets: 0, maxGap: null, backToBack: false }),
    ...advice.muscles.filter((m) => (["biceps", "triceps", "calves"] as Muscle[]).includes(m.muscle)),
  ];
  const sugg = volumeSuggestions(plan, templates, exercises, phase);
  const allChanges = sugg.flatMap((x) => x.changes);
  // Weekly sets once every suggestion is applied (includes knock-on helper sets, e.g. glutes from squats)
  const changed = new Map(applyChanges(templates, allChanges).map((t) => [t.id, t]));
  const afterAdvice = planAdvice(plan.map((p) => ({ date: p.date, template: p.template ? changed.get(p.template.id) ?? p.template : null })), exercises, phase);
  const after = new Map(afterAdvice.muscles.map((m) => [m.muscle, m.sets]));
  const full = sugg.filter((x) => x.full);
  const totals = sessionTotalsAfter(templates, allChanges);
  const [applying, setApplying] = useState(false);

  async function apply(changes: typeof allChanges) {
    setApplying(true);
    setError(null);
    try {
      for (const t of applyChanges(templates, changes)) {
        await saveTemplate({ id: t.id, name: t.name, notes: t.notes ?? "", exercises: t.exercises.map((e, i) => ({ ...e, position: i })) });
      }
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the templates.");
    } finally {
      setApplying(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePlan(dates, plan.filter((p) => p.template).map((p) => ({ planned_on: p.date, template_id: p.template!.id })));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the plan.");
      setBusy(false);
    }
  }

  if (!templates.length) {
    return (
      <div className="empty">
        <p>Create a workout template first, then plan which days you'll do it.</p>
        <button className="btn primary" onClick={onClose}>Back</button>
      </div>
    );
  }

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Plan your week</h1>
          <p className="muted small">{active ? `Fills in ${active.name} in order. Change any day.` : "Pick the days you can train."}</p>
        </div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>

      <div className="plan-quick" role="group" aria-label="Quick plans">
        <span className="small muted">Best spacing for</span>
        {[2, 3, 4].map((n) => <button key={n} className="fchip" onClick={() => quick(n)}>{n} days</button>)}
      </div>

      <div className="panel list-panel" style={{ marginTop: 10 }}>
        {dates.map((d, i) => {
          const l = dayLabel(d, i);
          const r = rows[d];
          return (
            <div key={d} className={`list-row static plan-row${r.template_id ? " on" : ""}`}>
              <button className="plan-day" onClick={() => toggle(d)} aria-pressed={Boolean(r.template_id)}>
                <span className="plan-check" aria-hidden="true">{r.template_id ? "✓" : ""}</span>
                <span>
                  <strong>{l.top}</strong>
                  <span className="small muted" style={{ display: "block" }}>{l.sub}</span>
                </span>
              </button>
              <select className="input plan-select" value={r.template_id ?? ""} onChange={(e) => pick(d, e.target.value)} aria-label={`Workout for ${l.top}`}>
                <option value="">Rest</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <section className="section">
        <h2 style={{ marginBottom: 8 }}>{advice.sessions} session{advice.sessions === 1 ? "" : "s"} · coach check</h2>
        <div className="stack">
          {advice.items.filter((it) => !/weekly sets|High volume/.test(it.title)).map((it, i) => (
            <div key={i} className={`coach-alert tone-${it.tone}`}>
              <p><strong>{it.title}.</strong> {it.text}</p>
            </div>
          ))}
        </div>
      </section>

      {shown.length > 0 && (
        <section className="section">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2>Weekly sets</h2>
            <span className="muted small">Targets for {phase ?? "maintenance"}</span>
          </div>
          <div className="panel">
            {shown.map((m) => {
              const t = setTarget(m.muscle as Muscle, phase);
              const to = allChanges.length ? after.get(m.muscle as Muscle) ?? 0 : undefined;
              const scale = Math.max(t.max + 4, m.sets, to ?? 0);
              const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
              const state = m.sets < t.min ? "low" : m.sets > t.max ? "high" : "ok";
              return (
                <div key={m.muscle} className="set-row-target">
                  <span className="st-label">{MUSCLE_LABEL[m.muscle]}<span className="small muted"> {m.sessions}×</span></span>
                  <span className="st-track" aria-hidden="true">
                    <span className="st-band" style={{ left: pct(t.min), width: `calc(${pct(t.max)} - ${pct(t.min)})` }} />
                    {to != null && to !== m.sets && <span className="st-after" style={{ width: pct(to) }} />}
                    <span className={`st-fill ${state}`} style={{ width: pct(m.sets) }} />
                  </span>
                  <span className="st-num num">{m.sets}{to != null && to !== m.sets ? <span className="st-to"> → {to}</span> : null}<span className="small muted"> / {t.min}–{t.max}</span></span>
                </div>
              );
            })}
            <p className="chart-note">Hard sets per week from the templates planned above. An exercise's main muscle counts in full and the muscles that help move the weight count half (triceps on bench, biceps on rows, glutes on squats), the counting that best predicted growth across 67 studies. Set them per exercise in its edit form. The shaded band is the target: 10+ sets per muscle is where most growth research lands{phase === "deficit" ? ", and in a deficit 10–16 holds muscle without outrunning recovery" : ""}.</p>
          </div>

          {sugg.some((x) => x.changes.length) ? (
            <>
              <h3 style={{ margin: "14px 0 6px" }}>To hit your targets</h3>
              <div className="panel list-panel">
                {sugg.filter((x) => x.changes.length).map((x) => (
                  <div key={x.muscle} className="list-row static" style={{ alignItems: "flex-start" }}>
                    <span style={{ minWidth: 0 }}>
                      <strong>{MUSCLE_LABEL[x.muscle]}</strong> <span className="small muted">{x.from} → {x.to} sets</span>
                      <span className="small" style={{ display: "block" }}>{x.text}</span>
                      {x.note && <span className="small muted" style={{ display: "block" }}>{x.note}</span>}
                    </span>
                    <button className="link small" disabled={applying} onClick={() => apply(x.changes)}>Apply</button>
                  </div>
                ))}
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                After the changes: {[...totals.entries()].map(([id, n]) => `${templates.find((t) => t.id === id)?.name} ${n} sets`).join(", ")}. Sessions stay under about {SESSION_TOTAL_CAP} working sets (60–75 min) and any one muscle under ~10 sets per session. New exercises start at 8–12 reps @ RPE 8; the coach takes over from there.
              </p>
              <button className="btn block" style={{ marginTop: 8 }} disabled={applying} onClick={() => apply(allChanges)}>{applying ? "Updating templates…" : "Apply all to my templates"}</button>
            </>
          ) : advice.sessions > 0 && !full.length ? (
            <p className="small" style={{ marginTop: 10 }}><span className="coach-chip tone-good">On target</span> Every muscle you train is in its weekly set range for this plan.</p>
          ) : null}

          {full.length > 0 && (
            <div className="coach-alert tone-warn" style={{ marginTop: 10 }}>
              <p><strong>{MUSCLE_LABEL[full[0].muscle]}{full.length > 1 ? ` and ${full.length - 1} more` : ""} can't reach target.</strong> {advice.sessions === 1 ? "One session" : `Your ${advice.sessions} sessions`} can't fit more without going past ~{SESSION_TOTAL_CAP} sets each. {advice.sessions < 4 ? "Another training day, even a 30-minute one, is how to get there." : "Trim another muscle to make room."} {phase === "deficit" ? "In a deficit, slightly under target with hard sets still holds muscle." : ""}</p>
              {advice.sessions < 4 && <button className="btn ghost" onClick={() => quick(advice.sessions + 1)}>Try {advice.sessions + 1} days</button>}
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <button className="btn primary block" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save plan"}</button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Planned for {ymd(new Date()) === dates[0] ? "today" : dates[0]} to {fromYmd(dates[6]).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}. Next up follows the plan on those days; you can still start any workout any day.</p>
    </>
  );
}
