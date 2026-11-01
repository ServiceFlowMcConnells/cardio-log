import { useEffect, useState } from "react";
import type { DayActivity, HealthStatus } from "../lib/health";
import { fromYmd } from "../lib/nutrition";
import { connectHealth, disconnectHealth, healthConnected, healthStatus, healthSupported, hm, lastSync, openHealthSettings, syncHealth } from "../lib/health";

/** Settings panel: connect Health Connect, see what came in, sync now. */
export default function HealthConnectSettings({ activity, onSynced }: { activity: DayActivity[]; onSynced: () => void }) {
  const supported = healthSupported();
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => { if (supported) healthStatus().then(setStatus).catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })); }, [supported]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(false); tick((n) => n + 1); }
  }
  const connect = () => run(async () => {
    const st = await connectHealth();
    setStatus(st);
    if (!st.steps && !st.sleep) return "Nothing was allowed. Tap Connect again, or allow Training Log in Health Connect's settings.";
    const n = await syncHealth();
    onSynced();
    return `Connected. Brought in ${n} day${n === 1 ? "" : "s"}${st.history === false ? " (the last 30 days: allow \"past data\" in Health Connect for more)" : ""}.`;
  });
  const sync = () => run(async () => { const n = await syncHealth(14); onSynced(); return `Synced ${n} day${n === 1 ? "" : "s"}.`; });
  const resync = () => run(async () => { const n = await syncHealth(400); onSynced(); return `Re-read ${n} day${n === 1 ? "" : "s"} of history.`; });

  const latest = [...activity].reverse();
  const dayName = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
  const lastSteps = latest.find((d) => d.steps != null);
  const lastSleep = latest.find((d) => d.sleep_minutes != null);
  const ls = lastSync();
  const connected = healthConnected() && status?.available && (status.steps || status.sleep);

  return (
    <section className="section panel stack">
      <h2>Health Connect</h2>
      {!supported ? (
        <p className="muted small">
          Steps and sleep come from Health Connect on your phone. Open Training Log in the Android app (version 1.0.6 or later) to connect it.
          {lastSteps && ` Last synced data: ${lastSteps.steps!.toLocaleString("en-IE")} steps on ${dayName(lastSteps.day)}.`}
        </p>
      ) : status && !status.available ? (
        <p className="muted small">Health Connect isn't available on this phone{status.reason ? ` (${status.reason})` : ""}. On Android 13 or older, install "Health Connect" from the Play Store, then come back.</p>
      ) : (
        <>
          <p className="muted small">Reads your daily steps and sleep (from your watch, phone or any app that writes to Health Connect). Training Log only reads; it never writes to Health Connect.</p>
          {status && (
            <p className="small">
              Steps: <strong>{status.steps ? "allowed" : "not allowed"}</strong> · Sleep: <strong>{status.sleep ? "allowed" : "not allowed"}</strong>
              {ls && <span className="muted"> · last synced {new Date(ls).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
            </p>
          )}
          {(lastSteps || lastSleep) && (
            <p className="muted small">
              {lastSteps && `${lastSteps.steps!.toLocaleString("en-IE")} steps on ${dayName(lastSteps.day)}`}
              {lastSteps && lastSleep && " · "}
              {lastSleep && `${hm(lastSleep.sleep_minutes!)} asleep the night before ${dayName(lastSleep.day)}`}
            </p>
          )}
          {connected ? (
            <>
              <button className="btn block" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
              <div className="chip-row">
                <button className="link small" disabled={busy} onClick={resync}>Re-read history</button>
                <button className="link small" onClick={() => openHealthSettings().catch(() => {})}>Manage access in Health Connect</button>
                <button className="link small" onClick={() => { disconnectHealth(); tick((n) => n + 1); setStatus((s) => s && { ...s, steps: false, sleep: false }); }}>Stop syncing</button>
              </div>
            </>
          ) : (
            <button className="btn primary block" disabled={busy || !status} onClick={connect}>{busy ? "Connecting…" : "Connect Health Connect"}</button>
          )}
        </>
      )}
      {msg && <p className={msg.ok ? "ok" : "error"} role="status">{msg.text}</p>}
    </section>
  );
}
