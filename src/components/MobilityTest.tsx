import { useState } from "react";
import type { MobilityTest as Test, TestResult } from "../lib/mobility";
import { AREA_LABEL, SCORE_LABEL, TESTS, areaScores, overallScore } from "../lib/mobility";
import { saveMobilityTest } from "../lib/mobilityData";

interface Props {
  previous: Test | null;
  onClose: () => void;
  onSaved: () => void;
}

const OPTS: { v: 1 | 2 | 3; label: string }[] = [
  { v: 3, label: "Good" },
  { v: 2, label: "OK" },
  { v: 1, label: "Restricted" },
];

export default function MobilityTest({ previous, onClose, onSaved }: Props) {
  const [step, setStep] = useState(0); // 0..TESTS.length-1, then results
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = step >= TESTS.length;

  if (done) {
    const scores = areaScores(results);
    const prevScores = previous ? areaScores(previous.results) : {};
    const total = overallScore(results);
    const painful = TESTS.filter((t) => results[t.id]?.pain);
    async function save() {
      setBusy(true);
      setError(null);
      try {
        await saveMobilityTest(results, total, null);
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
        setBusy(false);
      }
    }
    return (
      <>
        <div className="editor-bar">
          <div>
            <h1>Your mobility score</h1>
            <p className="muted small">Retest in about 4 weeks to see what's changed.</p>
          </div>
          <button className="btn ghost" onClick={() => setStep(TESTS.length - 1)}>Back</button>
        </div>
        <div className="mob-score-card">
          <span className="mob-score">{total}</span>
          <span>
            <strong>{SCORE_LABEL(total)}</strong>
            {previous && <span className="small" style={{ display: "block" }}>{total - previous.score >= 0 ? "+" : ""}{total - previous.score} since your last screen ({previous.score})</span>}
          </span>
        </div>
        <div className="panel" style={{ marginTop: 10 }}>
          {Object.entries(scores).map(([a, v]) => (
            <AreaBar key={a} label={AREA_LABEL[a as keyof typeof AREA_LABEL]} v={v!} prev={prevScores[a as keyof typeof prevScores]} />
          ))}
        </div>
        {painful.length > 0 && (
          <div className="coach-alert tone-warn" style={{ marginTop: 10 }}>
            <p><strong>Pain during {painful.map((t) => t.name.toLowerCase()).join(", ")}.</strong> Those areas get gentle drills only. If pain keeps coming back, or there's numbness or tingling, get it checked by a physio.</p>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>Your routines now target the lowest-scoring areas first. This is a self-screen to guide drills, not a medical assessment.</p>
        {error && <p className="error">{error}</p>}
        <div className="save-bar">
          <button className="btn primary block" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save results"}</button>
        </div>
      </>
    );
  }

  const t = TESTS[step];
  const r = results[t.id];
  const set = (patch: Partial<TestResult>) => setResults((x) => ({ ...x, [t.id]: { ...(x[t.id] ?? { score: 2, pain: false }), ...patch } }));

  return (
    <>
      <div className="editor-bar">
        <span className="muted small">Test {step + 1} of {TESTS.length} · {AREA_LABEL[t.area]}</span>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <div className="mob-progress" aria-hidden="true"><span style={{ width: `${(step / TESTS.length) * 100}%` }} /></div>

      <section className="section" style={{ marginTop: 10 }}>
        <h1 style={{ fontSize: "1.9rem" }}>{t.name}</h1>
        <p className="mob-how">{t.how}</p>
      </section>

      <div className="stack" role="radiogroup" aria-label="Result">
        {OPTS.map((o) => (
          <button key={o.v} className={`mob-opt s${o.v}${r?.score === o.v ? " on" : ""}`} role="radio" aria-checked={r?.score === o.v} onClick={() => set({ score: o.v })}>
            <strong>{o.label}</strong>
            <span className="small">{o.v === 3 ? t.good : o.v === 2 ? t.ok : t.restricted}</span>
          </button>
        ))}
      </div>

      {t.measure && (
        <label className="field" style={{ marginTop: 12 }}>
          <span>{t.measure.label} ({t.measure.unit}, optional)</span>
          <input className="input" inputMode="decimal" value={r?.value ?? ""} onChange={(e) => {
            const n = parseFloat(e.target.value.replace(",", "."));
            const v = Number.isFinite(n) ? n : null;
            const score: 1 | 2 | 3 | undefined = v == null ? undefined : v >= 10 ? 3 : v >= 6 ? 2 : 1;
            set(score ? { value: v, score } : { value: v });
          }} />
        </label>
      )}

      <label className="toggle" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={Boolean(r?.pain)} onChange={(e) => set({ pain: e.target.checked })} />
        <span>It hurt (not just a stretch)<span className="small muted" style={{ display: "block" }}>That area will get gentle drills only.</span></span>
      </label>

      <div className="save-bar mob-controls">
        <button className="btn ghost" onClick={() => (step > 0 ? setStep(step - 1) : onClose())}>‹ Back</button>
        <button className="btn primary" disabled={!r} onClick={() => setStep(step + 1)}>{step + 1 < TESTS.length ? "Next" : "See results"}</button>
        <button className="btn ghost" onClick={() => { setResults((x) => { const y = { ...x }; delete y[t.id]; return y; }); setStep(step + 1); }}>Skip ›</button>
      </div>
    </>
  );
}

export function AreaBar({ label, v, prev }: { label: string; v: number; prev?: number }) {
  const tone = v >= 67 ? "good" : v >= 34 ? "ok" : "low";
  return (
    <div className="mob-arearow">
      <span className="mob-arealabel">{label}</span>
      <span className="mob-track"><span className={`mob-fill ${tone}`} style={{ width: `${Math.max(4, v)}%` }} />{prev != null && <span className="mob-prev" style={{ left: `${prev}%` }} title={`Last time ${prev}`} />}</span>
      <span className="mob-areav num">{v}</span>
    </div>
  );
}
