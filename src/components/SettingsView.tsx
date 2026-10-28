import { useState } from "react";
import type { Session, Settings } from "../lib/types";
import type { Exercise, Workout } from "../lib/strength";
import { saveSettings } from "../lib/data";
import { toCsv } from "../lib/calc";
import { supabase } from "../lib/supabase";

interface Props {
  settings: Settings;
  sessions: Session[];
  workouts: Workout[];
  exercises: Exercise[];
  email: string;
  onSaved: (s: Settings) => void;
  onBack: () => void;
}

export default function SettingsView({ settings, sessions, workouts, exercises, email, onSaved, onBack }: Props) {
  const [target, setTarget] = useState(String(settings.weekly_target_min));
  const [maxHr, setMaxHr] = useState(settings.max_hr ? String(settings.max_hr) : "");
  const [age, setAge] = useState("");
  const [low, setLow] = useState(String(settings.zone_low_pct));
  const [high, setHigh] = useState(String(settings.zone_high_pct));
  const [inc, setInc] = useState(String(settings.weight_increment));
  const [rest, setRest] = useState(String(settings.default_rest_sec));
  const [formula, setFormula] = useState<Settings["e1rm_formula"]>(settings.e1rm_formula);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mh = Number(maxHr);
  const lo = Number(low);
  const hi = Number(high);
  const preview = mh >= 100 && mh <= 230 && lo > 0 && hi > lo ? `${Math.round((mh * lo) / 100)}–${Math.round((mh * hi) / 100)} bpm` : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(target);
    if (!Number.isInteger(t) || t < 0 || t > 2000) return setMsg({ ok: false, text: "Weekly target should be a whole number of minutes." });
    if (maxHr && (!Number.isInteger(mh) || mh < 100 || mh > 230)) return setMsg({ ok: false, text: "Max heart rate should be between 100 and 230." });
    if (!(lo >= 40 && hi <= 100 && hi > lo)) return setMsg({ ok: false, text: "Zone should be two percentages between 40 and 100, low first." });
    const incN = Number(inc.replace(",", "."));
    if (!(incN > 0 && incN <= 20)) return setMsg({ ok: false, text: "Weight increment should be between 0.25 and 20 kg." });
    const restN = Number(rest);
    if (!Number.isInteger(restN) || restN < 0 || restN > 900) return setMsg({ ok: false, text: "Rest should be 0 to 900 seconds." });
    const next: Settings = { weekly_target_min: t, max_hr: maxHr ? mh : null, zone_low_pct: lo, zone_high_pct: hi, weight_increment: incN, default_rest_sec: restN, e1rm_formula: formula, deload_until: settings.deload_until };
    setBusy(true);
    setMsg(null);
    try {
      await saveSettings(next);
      onSaved(next);
      setMsg({ ok: true, text: "Settings saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save." });
    } finally {
      setBusy(false);
    }
  }

  function download(csv: string, name: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const exportCsv = () => download(toCsv(sessions), "cardio-log");
  const exportLifts = () => download(liftsCsv(workouts, exercises), "strength-log");

  return (
    <>
      <div className="editor-bar">
        <h1>Settings</h1>
        <button className="btn ghost" onClick={onBack}>Done</button>
      </div>
      <form className="panel stack" onSubmit={save}>
        <h2>Targets</h2>
        <label className="field">
          <span>Weekly cardio target (minutes)</span>
          <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>

        <h2 style={{ paddingTop: 10 }}>Heart rate zone</h2>
        <label className="field">
          <span>Max heart rate (bpm)</span>
          <input className="input" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="e.g. 185" />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Don't know it? Estimate from age</span>
            <input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Age" />
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const a = Number(age);
              if (a >= 14 && a <= 90) setMaxHr(String(Math.round(208 - 0.7 * a)));
            }}
          >
            Estimate
          </button>
        </div>
        <p className="muted small">Uses 208 − 0.7 × age. A max you've actually seen on a hard effort is better.</p>
        <div className="grid c2">
          <label className="field">
            <span>Zone low (% of max)</span>
            <input className="input" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <label className="field">
            <span>Zone high (% of max)</span>
            <input className="input" inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
        </div>
        <p className="muted small">{preview ? `Your zone: ${preview}.` : "Set your max heart rate to see your zone."} 60–75% suits steady fat-loss cardio; check with your coach.</p>

        <h2 style={{ paddingTop: 10 }}>Strength</h2>
        <div className="grid c2">
          <label className="field">
            <span>Smallest weight jump (kg)</span>
            <input className="input" inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} />
          </label>
          <label className="field">
            <span>Default rest (seconds)</span>
            <input className="input" inputMode="numeric" value={rest} onChange={(e) => setRest(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Suggested weights round to this jump: 2.5 kg for a barbell with 1.25 kg plates, or match your dumbbell steps.</p>
        <label className="field">
          <span>Estimated 1RM method</span>
          <select className="input" value={formula} onChange={(e) => setFormula(e.target.value as Settings["e1rm_formula"])}>
            <option value="rpe">RTS RPE chart (uses the RPE you log)</option>
            <option value="epley">Epley</option>
            <option value="brzycki">Brzycki</option>
          </select>
        </label>
        <p className="muted small">
          All three use your logged RPE as reps in reserve: 100 kg × 5 at RPE 8 counts like 7 reps to failure. Sets without an RPE are treated as close to failure. The RPE chart is the most accurate if you log RPE; Brzycki is the most conservative.
        </p>

        {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
        <button className="btn dark block" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </form>

      <section className="section panel stack">
        <h2>Your data</h2>
        <p className="muted small">Download everything as spreadsheets, for your coach or a backup.</p>
        <button className="btn ghost block" onClick={exportCsv} disabled={sessions.length === 0}>Download cardio CSV</button>
        <button className="btn ghost block" onClick={exportLifts} disabled={workouts.length === 0}>Download strength CSV</button>
      </section>

      <section className="section panel stack">
        <h2>Account</h2>
        <p className="muted small">Signed in as {email}</p>
        <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </>
  );
}

function liftsCsv(workouts: Workout[], exercises: Exercise[]): string {
  const names = new Map(exercises.map((e) => [e.id, e.name]));
  const esc = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["date", "time", "workout", "exercise", "set", "type", "weight_kg", "reps", "rpe", "notes"].join(",")];
  for (const w of [...workouts].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const d = new Date(w.started_at);
    const p = (n: number) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
    for (const s of w.sets) {
      rows.push([date, time, w.name, names.get(s.exercise_id) ?? "", s.set_number, s.set_type, s.weight_kg, s.reps, s.rpe, w.notes].map(esc).join(","));
    }
  }
  return rows.join("\n");
}
