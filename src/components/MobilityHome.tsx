import type { AppData } from "../App";
import type { Template } from "../lib/strength";
import { AREA_LABEL, NIGGLE_LABEL, SCORE_LABEL, activeNiggles, areaScores, daysThisWeek, doneToday, doseText, fmtMin, isBlocked, needsRetest } from "../lib/mobility";
import { formatShort } from "../lib/dates";
import { buildRoutine } from "./MobilityPlayer";
import { AreaBar } from "./MobilityTest";

interface Props {
  data: AppData;
  onBack: () => void;
  onTest: () => void;
  onNiggles: () => void;
  onPlay: (kind: "daily" | "prewarm", template: Template | null) => void;
}

export default function MobilityHome({ data, onBack, onTest, onNiggles, onPlay }: Props) {
  const test = data.mobilityTests[0] ?? null;
  const prev = data.mobilityTests[1] ?? null;
  const nig = activeNiggles(data.niggles);
  const routine = buildRoutine(data, "daily", null);
  const today = doneToday(data.mobilitySessions);
  const week = daysThisWeek(data.mobilitySessions);
  const scores = test ? areaScores(test.results) : {};
  const prevScores = prev ? areaScores(prev.results) : {};

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Mobility</h1>
          <p className="muted small">{week ? `${week} day${week === 1 ? "" : "s"} in the last 7` : "Short, daily, bodyweight only"}</p>
        </div>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>

      {!test ? (
        <button className="mob-cta" onClick={onTest}>
          <strong>Take the mobility screen</strong>
          <span className="small">8 quick self-tests at home, about 8 minutes. It scores each area and builds your routines around what's tight.</span>
          <span aria-hidden="true" className="mob-cta-arrow">›</span>
        </button>
      ) : (
        <section className="panel">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <div className="mob-score-inline">
              <span className="mob-score sm">{test.score}</span>
              <span><strong>{SCORE_LABEL(test.score)}</strong><span className="small muted" style={{ display: "block" }}>Screened {formatShort(new Date(test.tested_at))}{prev ? `, ${test.score - prev.score >= 0 ? "+" : ""}${test.score - prev.score} vs last` : ""}</span></span>
            </div>
            <button className={needsRetest(test) ? "btn primary" : "link small"} onClick={onTest}>Retest</button>
          </div>
          {Object.entries(scores).map(([a, v]) => (
            <AreaBar key={a} label={AREA_LABEL[a as keyof typeof AREA_LABEL]} v={v!} prev={prevScores[a as keyof typeof prevScores]} />
          ))}
          {needsRetest(test) && <p className="small" style={{ marginTop: 6 }}>It's been 4 weeks. A retest shows what's improved and re-aims your routines.</p>}
        </section>
      )}

      <section className="section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>Today · 10 min</h2>
          {today && <span className="chip mob-done">Done</span>}
        </div>
        {routine && routine.items.length ? (
          <div className="tpl mob-tpl">
            <div className="tpl-head">
              <h3>{routine.focus.slice(0, 3).map((s) => AREA_LABEL[s.area]).join(", ") || "Full body"}</h3>
              <span className="muted small">{routine.items.length} drills, {fmtMin(routine.seconds)}</span>
            </div>
            <ul className="tpl-list">
              {routine.items.slice(0, 5).map((it) => (
                <li key={it.drill.id}>{it.drill.name} <span className="muted">{doseText(it.drill)}</span></li>
              ))}
              {routine.items.length > 5 && <li className="muted">+ {routine.items.length - 5} more</li>}
            </ul>
            <div className="tpl-foot">
              <span className="muted small">{test ? "Built from your screen and niggles" : "General routine until you screen"}</span>
              <button className="btn primary" onClick={() => onPlay("daily", null)}>{today ? "Again" : "Start"}</button>
            </div>
          </div>
        ) : (
          <p className="muted small">Nothing to build right now. Check your niggles.</p>
        )}
        {routine?.note && <p className="small" style={{ marginTop: 8 }}>{routine.note}</p>}
      </section>

      <section className="section">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2>Niggles</h2>
          <button className="link small" onClick={onNiggles}>{nig.length ? "Manage" : "+ Add"}</button>
        </div>
        {nig.length ? (
          <div className="nig-chips">
            {nig.map((n) => (
              <button key={n.id} className={`chip nig-chip${isBlocked(n) ? " blocked" : ""}`} onClick={onNiggles}>
                {NIGGLE_LABEL[n.area]}{n.side !== "both" ? ` ${n.side[0].toUpperCase()}` : ""} · {n.kind} {n.level}/5
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing logged. Add any tight or achy spots and routines will work on them (sharp pain gets rested instead).</p>
        )}
      </section>

      {data.templates.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 4 }}>Before a workout · 5 min</h2>
          <p className="muted small" style={{ marginBottom: 10 }}>A RAMP warm-up for the joints that template loads. Do it, then your warm-up sets.</p>
          <div className="panel list-panel">
            {data.templates.map((t) => (
              <button key={t.id} className="list-row" onClick={() => onPlay("prewarm", t)}>
                <span><strong>{t.name}</strong></span>
                <span className="row-v small">Warm up ›</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {data.mobilitySessions.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 10 }}>Recent</h2>
          <div className="panel list-panel">
            {data.mobilitySessions.slice(0, 6).map((s) => {
              const t = data.templates.find((x) => x.id === s.template_id);
              const fb = Object.entries(s.feedback);
              return (
                <div key={s.id} className="list-row static">
                  <span>
                    <strong>{s.kind === "prewarm" ? `Warm-up${t ? `: ${t.name}` : ""}` : "Daily routine"}</strong>
                    <span className="small muted" style={{ display: "block" }}>
                      {s.drills.length} drills{fb.some(([, v]) => v === "better") ? `, better: ${fb.filter(([, v]) => v === "better").map(([a]) => AREA_LABEL[a as keyof typeof AREA_LABEL]).join(", ")}` : ""}
                      {fb.some(([, v]) => v === "worse") ? `, worse: ${fb.filter(([, v]) => v === "worse").map(([a]) => AREA_LABEL[a as keyof typeof AREA_LABEL]).join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="row-v small muted">{formatShort(new Date(s.done_at))} · {fmtMin(s.duration_sec)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p className="muted small" style={{ marginTop: 18 }}>
        A guide for general mobility, not medical advice. Move within a comfortable stretch; stop anything sharp. Persistent pain, numbness or tingling needs a physio or GP.
      </p>
    </>
  );
}
