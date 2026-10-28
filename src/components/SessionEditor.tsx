import { useEffect, useMemo, useState } from "react";
import type { Block, Machine, Session, Settings } from "../lib/types";
import { MACHINE_LABEL } from "../lib/types";
import { formatDay, toLocalInput } from "../lib/dates";
import { settingsSummary, zoneFor, zoneStatus } from "../lib/calc";
import { deleteSession, saveSession } from "../lib/data";

type Field =
  | "duration_min" | "avg_hr" | "max_hr" | "distance_km" | "calories"
  | "speed_kmh" | "incline_pct" | "resistance" | "rpm" | "avg_watts";

const FIELDS: Field[] = ["duration_min", "avg_hr", "max_hr", "distance_km", "calories", "speed_kmh", "incline_pct", "resistance", "rpm", "avg_watts"];
const SETTING_FIELDS: Record<Machine, Field[]> = {
  treadmill: ["speed_kmh", "incline_pct"],
  bike: ["resistance", "rpm", "avg_watts"],
};

interface BlockDraft {
  key: string;
  machine: Machine;
  values: Record<Field, string>;
  rpe: number | null;
  is_benchmark: boolean;
}

interface Draft {
  id?: string;
  performed_at: string; // datetime-local
  notes: string;
  blocks: BlockDraft[];
  timerStart: number | null;
  timerStoppedAt: number | null;
}

const DRAFT_KEY = "cardio-log:draft";

export function hasDraft(): boolean {
  try {
    return Boolean(localStorage.getItem(DRAFT_KEY));
  } catch {
    return false;
  }
}
function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: draft just won't survive a reload */
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyValues = (): Record<Field, string> => Object.fromEntries(FIELDS.map((f) => [f, ""])) as Record<Field, string>;
const str = (n: number | null) => (n == null ? "" : String(n));

function blockToDraft(b: Block): BlockDraft {
  const values = emptyValues();
  for (const f of FIELDS) values[f] = str(b[f]);
  return { key: uid(), machine: b.machine, values, rpe: b.rpe, is_benchmark: b.is_benchmark };
}

function lastBlockFor(machine: Machine, sessions: Session[], excludeId?: string): { block: Block; date: Date } | null {
  for (const s of sessions) {
    if (s.id === excludeId) continue;
    for (let i = s.blocks.length - 1; i >= 0; i--) {
      if (s.blocks[i].machine === machine) return { block: s.blocks[i], date: new Date(s.performed_at) };
    }
  }
  return null;
}

function newBlock(machine: Machine, sessions: Session[], excludeId?: string): BlockDraft {
  const values = emptyValues();
  const last = lastBlockFor(machine, sessions, excludeId);
  if (last) {
    // Start from last time's settings, like Strong pre-fills last weights.
    values.duration_min = str(last.block.duration_min);
    for (const f of SETTING_FIELDS[machine]) values[f] = str(last.block[f]);
  }
  return { key: uid(), machine, values, rpe: null, is_benchmark: false };
}

function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const RPE_TEXT: Record<number, string> = {
  1: "Very easy", 2: "Very easy",
  3: "Easy, could chat all day", 4: "Comfortable, can hold a conversation",
  5: "Breathing harder, can talk in sentences", 6: "Short sentences only",
  7: "Hard, a few words at a time", 8: "Very hard, single words",
  9: "Near max", 10: "All out",
};

const LABELS: Record<Field, string> = {
  duration_min: "Minutes",
  avg_hr: "Avg HR (bpm)",
  max_hr: "Max HR (bpm)",
  distance_km: "Distance (km)",
  calories: "Calories",
  speed_kmh: "Speed (km/h)",
  incline_pct: "Incline (%)",
  resistance: "Level",
  rpm: "RPM",
  avg_watts: "Avg watts",
};

const LIMITS: Partial<Record<Field, [number, number]>> = {
  duration_min: [0.5, 600], avg_hr: [40, 230], max_hr: [40, 240], speed_kmh: [0, 30],
  incline_pct: [-5, 40], rpm: [0, 250], avg_watts: [0, 2000], distance_km: [0, 200], calories: [0, 10000], resistance: [0, 100],
};

interface Props {
  session: Session | null;
  allSessions: Session[];
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export default function SessionEditor({ session, allSessions, settings, onClose, onSaved, onDeleted }: Props) {
  const isEdit = Boolean(session);
  const [draft, setDraft] = useState<Draft>(() => {
    if (session) {
      return {
        id: session.id,
        performed_at: toLocalInput(new Date(session.performed_at)),
        notes: session.notes ?? "",
        blocks: session.blocks.map(blockToDraft),
        timerStart: null,
        timerStoppedAt: null,
      };
    }
    const saved = readDraft();
    if (saved && !saved.id) return saved;
    return { performed_at: toLocalInput(new Date()), notes: "", blocks: [], timerStart: null, timerStoppedAt: null };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(Date.now());
  const z = zoneFor(settings);

  // Keep new-session drafts so a reload mid-workout doesn't lose anything.
  useEffect(() => {
    if (!isEdit) writeDraft(draft);
  }, [draft, isEdit]);

  const running = draft.timerStart != null && draft.timerStoppedAt == null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsedMs = draft.timerStart ? (draft.timerStoppedAt ?? now) - draft.timerStart : 0;
  const elapsedMin = elapsedMs / 60000;
  const clock = useMemo(() => {
    const s = Math.max(0, Math.floor(elapsedMs / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }, [elapsedMs]);

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => fn(d));
  const updateBlock = (key: string, fn: (b: BlockDraft) => BlockDraft) =>
    update((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? fn(b) : b)) }));

  function addBlock(machine: Machine) {
    update((d) => ({ ...d, blocks: [...d.blocks, newBlock(machine, allSessions, d.id)] }));
  }

  function fillFromTimer(key: string) {
    const others = draft.blocks
      .filter((b) => b.key !== key)
      .reduce((a, b) => a + (parseNum(b.values.duration_min) || 0), 0);
    const mins = Math.max(0.5, Math.round((elapsedMin - others) * 10) / 10);
    updateBlock(key, (b) => ({ ...b, values: { ...b.values, duration_min: String(mins) } }));
  }

  function validate(): Block[] | string {
    if (draft.blocks.length === 0) return "Add a treadmill or bike block first.";
    const out: Block[] = [];
    for (const [i, b] of draft.blocks.entries()) {
      const name = `${MACHINE_LABEL[b.machine]}${draft.blocks.length > 1 ? ` (block ${i + 1})` : ""}`;
      const vals = {} as Record<Field, number | null>;
      for (const f of FIELDS) {
        const n = parseNum(b.values[f]);
        if (Number.isNaN(n)) return `${name}: ${LABELS[f]} isn't a number.`;
        const lim = LIMITS[f];
        if (n != null && lim && (n < lim[0] || n > lim[1])) return `${name}: ${LABELS[f]} should be between ${lim[0]} and ${lim[1]}.`;
        vals[f] = n;
      }
      if (vals.duration_min == null) return `${name}: enter how many minutes.`;
      out.push({
        position: i,
        machine: b.machine,
        duration_min: vals.duration_min,
        avg_hr: vals.avg_hr,
        max_hr: vals.max_hr,
        rpe: b.rpe,
        distance_km: vals.distance_km,
        calories: vals.calories,
        speed_kmh: vals.speed_kmh,
        incline_pct: vals.incline_pct,
        resistance: vals.resistance,
        rpm: vals.rpm,
        avg_watts: vals.avg_watts,
        is_benchmark: b.is_benchmark,
      });
    }
    return out;
  }

  async function save() {
    const v = validate();
    if (typeof v === "string") {
      setError(v);
      return;
    }
    const when = new Date(draft.performed_at);
    if (Number.isNaN(when.getTime())) {
      setError("Set the date and time of the session.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveSession({ id: draft.id, performed_at: when.toISOString(), notes: draft.notes, blocks: v });
      if (!isEdit) writeDraft(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await deleteSession(draft.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? `Couldn't delete: ${e.message}` : "Couldn't delete.");
      setBusy(false);
    }
  }

  function discard() {
    if (!isEdit) writeDraft(null);
    onClose();
  }

  return (
    <>
      <div className="editor-bar">
        <h1>{isEdit ? "Edit session" : "Log session"}</h1>
        <button className="btn ghost" onClick={discard}>{isEdit ? "Close" : "Discard"}</button>
      </div>

      {!isEdit && (
        <div className="timer">
          <span className={`clock${running ? " running" : ""}`} aria-live="off">{clock}</span>
          {draft.timerStart == null ? (
            <button className="btn primary" onClick={() => update((d) => ({ ...d, timerStart: Date.now(), timerStoppedAt: null, performed_at: toLocalInput(new Date()) }))}>
              Start timer
            </button>
          ) : running ? (
            <button className="btn primary" onClick={() => update((d) => ({ ...d, timerStoppedAt: Date.now() }))}>Stop</button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={() => update((d) => ({ ...d, timerStart: (d.timerStart ?? Date.now()) + (Date.now() - (d.timerStoppedAt ?? Date.now())), timerStoppedAt: null }))}
              >
                Resume
              </button>
              <button className="btn" onClick={() => update((d) => ({ ...d, timerStart: null, timerStoppedAt: null }))}>Reset</button>
            </div>
          )}
        </div>
      )}

      <div className="grid c2" style={{ marginTop: 14 }}>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>When</span>
          <input
            className="input"
            type="datetime-local"
            value={draft.performed_at}
            onChange={(e) => update((d) => ({ ...d, performed_at: e.target.value }))}
          />
        </label>
      </div>

      <section className="section" aria-label="Blocks">
        {draft.blocks.length === 0 && (
          <div className="empty">
            <p>Add what you did. A session can mix treadmill and bike blocks.</p>
          </div>
        )}
        {draft.blocks.map((b, i) => {
          const last = lastBlockFor(b.machine, allSessions, draft.id);
          const hr = parseNum(b.values.avg_hr);
          const zs = zoneStatus(hr && !Number.isNaN(hr) ? hr : null, z);
          const fieldsRow = SETTING_FIELDS[b.machine];
          return (
            <div key={b.key} className={`block-card ${b.machine}`}>
              <div className="head">
                <h3>{draft.blocks.length > 1 ? `Block ${i + 1}: ` : ""}{MACHINE_LABEL[b.machine]}</h3>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${MACHINE_LABEL[b.machine]} block`}
                  onClick={() => update((d) => ({ ...d, blocks: d.blocks.filter((x) => x.key !== b.key) }))}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <p className="last">
                {last
                  ? `Last time (${formatDay(last.date)}): ${Math.round(last.block.duration_min)} min${settingsSummary(last.block) ? `, ${settingsSummary(last.block)}` : ""}${last.block.avg_hr ? `, ${last.block.avg_hr} bpm` : ""}`
                  : "First time on this machine. Note the settings so you can beat them next time."}
              </p>

              <div className={`grid ${b.machine === "bike" ? "c4" : "c3"}`}>
                <label className="field">
                  <span>{LABELS.duration_min}</span>
                  <input className="input" inputMode="decimal" value={b.values.duration_min}
                    onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, duration_min: e.target.value } }))} />
                </label>
                {fieldsRow.map((f) => (
                  <label className="field" key={f}>
                    <span>{LABELS[f]}</span>
                    <input className="input" inputMode={f === "rpm" || f === "avg_watts" ? "numeric" : "decimal"} value={b.values[f]}
                      onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, [f]: e.target.value } }))} />
                  </label>
                ))}
              </div>
              {draft.timerStart != null && (
                <button className="link small" style={{ marginTop: 8 }} onClick={() => fillFromTimer(b.key)}>
                  Use timer for minutes
                </button>
              )}

              <div className="grid c2" style={{ marginTop: 10 }}>
                <label className="field">
                  <span>{LABELS.avg_hr}</span>
                  <input className="input" inputMode="numeric" value={b.values.avg_hr}
                    onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, avg_hr: e.target.value } }))} />
                </label>
                <label className="field">
                  <span>{LABELS.max_hr}</span>
                  <input className="input" inputMode="numeric" value={b.values.max_hr}
                    onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, max_hr: e.target.value } }))} />
                </label>
              </div>
              {zs && z && (
                <p className="small" style={{ marginTop: 6 }}>
                  <span className={`chip ${zs}`}>
                    {zs === "in" ? "In your zone" : zs === "over" ? "Above your zone" : "Below your zone"} ({z.low}–{z.high} bpm)
                  </span>
                </p>
              )}

              <div style={{ marginTop: 12 }}>
                <span className="muted small" style={{ display: "block", marginBottom: 4, fontWeight: 500 }} id={`rpe-${b.key}`}>How hard did it feel? (RPE)</span>
                <div className="rpe" role="group" aria-labelledby={`rpe-${b.key}`}>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                    <button key={n} type="button" className={b.rpe === n ? "on" : ""} aria-pressed={b.rpe === n}
                      onClick={() => updateBlock(b.key, (x) => ({ ...x, rpe: x.rpe === n ? null : n }))}>
                      {n}
                    </button>
                  ))}
                </div>
                <p className="rpe-desc">{b.rpe ? RPE_TEXT[b.rpe] : "Aim for 5–7 on steady sessions."}</p>
              </div>

              <div className="grid c2" style={{ marginTop: 10 }}>
                <label className="field">
                  <span>{LABELS.distance_km}</span>
                  <input className="input" inputMode="decimal" value={b.values.distance_km}
                    onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, distance_km: e.target.value } }))} />
                </label>
                <label className="field">
                  <span>{LABELS.calories}</span>
                  <input className="input" inputMode="numeric" value={b.values.calories}
                    onChange={(e) => updateBlock(b.key, (x) => ({ ...x, values: { ...x.values, calories: e.target.value } }))} />
                </label>
              </div>

              <label className="toggle" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={b.is_benchmark}
                  onChange={(e) => updateBlock(b.key, (x) => ({ ...x, is_benchmark: e.target.checked }))} />
                <span>
                  <strong>Benchmark test</strong>
                  <span className="muted small" style={{ display: "block" }}>
                    Same settings and duration every time, so Progress can compare your heart rate.
                  </span>
                </span>
              </label>
            </div>
          );
        })}

        <div className="add-row">
          <button className="btn" onClick={() => addBlock("treadmill")}><i className="dot treadmill" /> Add treadmill</button>
          <button className="btn" onClick={() => addBlock("bike")}><i className="dot bike" /> Add bike</button>
        </div>
      </section>

      <section className="section">
        <label className="field">
          <span>Notes</span>
          <textarea className="input" value={draft.notes} placeholder="How it felt, anything to change next time"
            onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} />
        </label>
      </section>

      <div className="save-bar">
        {error && <p className="error panel" role="alert">{error}</p>}
        <button className="btn dark block" onClick={save} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Save session"}
        </button>
      </div>

      {isEdit && (
        <div style={{ marginTop: 28 }}>
          <button className="btn danger block" onClick={remove} disabled={busy}>
            {confirmDelete ? "Tap again to delete this session" : "Delete session"}
          </button>
        </div>
      )}
    </>
  );
}
