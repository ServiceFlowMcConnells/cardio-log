import { useState } from "react";
import type { Session, Settings } from "../lib/types";
import { saveSettings } from "../lib/data";
import { toCsv } from "../lib/calc";
import { supabase } from "../lib/supabase";

export default function SettingsView({ settings, sessions, email, onSaved }: { settings: Settings; sessions: Session[]; email: string; onSaved: (s: Settings) => void }) {
  const [target, setTarget] = useState(String(settings.weekly_target_min));
  const [maxHr, setMaxHr] = useState(settings.max_hr ? String(settings.max_hr) : "");
  const [age, setAge] = useState("");
  const [low, setLow] = useState(String(settings.zone_low_pct));
  const [high, setHigh] = useState(String(settings.zone_high_pct));
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
    const next: Settings = { weekly_target_min: t, max_hr: maxHr ? mh : null, zone_low_pct: lo, zone_high_pct: hi };
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

  function exportCsv() {
    const blob = new Blob([toCsv(sessions)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cardio-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
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

        {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
        <button className="btn dark block" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </form>

      <section className="section panel stack">
        <h2>Your data</h2>
        <p className="muted small">Download every block as a spreadsheet, for your coach or a backup.</p>
        <button className="btn ghost block" onClick={exportCsv} disabled={sessions.length === 0}>Download CSV</button>
      </section>

      <section className="section panel stack">
        <h2>Account</h2>
        <p className="muted small">Signed in as {email}</p>
        <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </>
  );
}
