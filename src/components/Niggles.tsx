import { useState } from "react";
import type { Niggle, NiggleArea } from "../lib/mobility";
import { NIGGLE_AREAS, NIGGLE_LABEL, isBlocked } from "../lib/mobility";
import { resolveNiggle, saveNiggle } from "../lib/mobilityData";
import { formatShort } from "../lib/dates";

interface Props {
  niggles: Niggle[];
  onBack: () => void;
  onChanged: () => void;
}

type Form = { id?: string; area: NiggleArea | null; side: Niggle["side"]; level: number; kind: Niggle["kind"]; red_flag: boolean; notes: string };
const blank: Form = { area: null, side: "both", level: 2, kind: "stiff", red_flag: false, notes: "" };
const LEVEL_TEXT = ["", "Barely there", "Noticeable", "Annoying", "Limits training", "Stops me"];
const SIDED: NiggleArea[] = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];

export default function Niggles({ niggles, onBack, onChanged }: Props) {
  const active = niggles.filter((n) => !n.resolved_at);
  const [form, setForm] = useState<Form | null>(active.length ? null : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      onChanged();
      setForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  const preview = form && form.area ? isBlocked({ ...form, area: form.area } as Niggle) : false;

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Niggles</h1>
          <p className="muted small">Aches and tight spots shape your routines. Sharp pain rests the area.</p>
        </div>
        <button className="btn ghost" onClick={onBack}>Done</button>
      </div>

      {active.length > 0 && (
        <div className="stack">
          {active.map((n) => (
            <div key={n.id} className={`panel nig-row${isBlocked(n) ? " blocked" : ""}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{NIGGLE_LABEL[n.area]}{n.side !== "both" ? ` (${n.side})` : ""}</strong>{" "}
                <span className="chip">{n.kind}</span> <span className="muted small">{n.level}/5 · since {formatShort(new Date(n.created_at))}</span>
                <span className="small" style={{ display: "block", marginTop: 2 }}>
                  {isBlocked(n) ? "Rested: no drills load this area. See a physio if it isn't settling." : n.level >= 3 ? "Gentle drills only, more often." : "Extra attention in your routines."}
                </span>
              </div>
              <div className="nig-actions">
                <button className="link small" onClick={() => setForm({ id: n.id, area: n.area, side: n.side, level: n.level, kind: n.kind, red_flag: n.red_flag, notes: n.notes ?? "" })}>Update</button>
                <button className="link small" disabled={busy} onClick={() => run(() => resolveNiggle(n.id))}>Gone</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!form ? (
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => setForm(blank)}>+ Add a niggle</button>
      ) : (
        <section className="section panel">
          <h2 style={{ marginBottom: 8 }}>{form.id ? "Update niggle" : "Where is it?"}</h2>
          <div className="nig-grid">
            {NIGGLE_AREAS.map((a) => (
              <button key={a} className={`fchip${form.area === a ? " on" : ""}`} aria-pressed={form.area === a} onClick={() => setForm({ ...form, area: a, side: SIDED.includes(a) ? form.side : "both" })}>
                {NIGGLE_LABEL[a]}
              </button>
            ))}
          </div>
          {form.area && SIDED.includes(form.area) && (
            <div className="seg" role="group" aria-label="Side" style={{ marginTop: 10 }}>
              {(["left", "right", "both"] as const).map((s) => (
                <button key={s} className={form.side === s ? "on" : ""} aria-pressed={form.side === s} onClick={() => setForm({ ...form, side: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
          )}

          <p className="small" style={{ margin: "12px 0 6px", fontWeight: 600 }}>What does it feel like?</p>
          <div className="seg" role="group" aria-label="Kind">
            {(["stiff", "achy", "sharp"] as const).map((k) => (
              <button key={k} className={form.kind === k ? "on" : ""} aria-pressed={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>

          <p className="small" style={{ margin: "12px 0 6px", fontWeight: 600 }}>How much? <span className="muted">{LEVEL_TEXT[form.level]}</span></p>
          <div className="rating-row" role="radiogroup" aria-label="Level">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} className={`r${6 - v}${form.level === v ? " on" : ""}`} role="radio" aria-checked={form.level === v} onClick={() => setForm({ ...form, level: v })}>
                <span className="rn">{v}</span>
              </button>
            ))}
          </div>

          <label className="toggle" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={form.red_flag} onChange={(e) => setForm({ ...form, red_flag: e.target.checked })} />
            <span>Numbness, tingling, swelling, or pain at night<span className="small muted" style={{ display: "block" }}>Any of these: rest it and get it checked.</span></span>
          </label>

          <label className="field" style={{ marginTop: 10 }}>
            <span>Notes (optional)</span>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. after squats, worse in the morning" />
          </label>

          {preview && (
            <div className="coach-alert tone-bad" style={{ marginTop: 10 }}>
              <p>{form.kind === "sharp" ? "Sharp pain" : form.red_flag ? "Those symptoms" : "A niggle this strong"} means routines will leave this area alone. If it doesn't ease within a week or two, or you're worried, see a physio or GP.</p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="tpl-foot">
            <button className="btn ghost" onClick={() => setForm(active.length ? null : blank)}>Cancel</button>
            <button className="btn primary" disabled={!form.area || busy} onClick={() => run(() => saveNiggle({ ...form, area: form.area!, notes: form.notes || null }))}>
              {busy ? "Saving…" : form.id ? "Update" : "Save"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
