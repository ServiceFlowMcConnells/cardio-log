import { useEffect, useState } from "react";
import type { PushState } from "../lib/restAlert";
import { disablePush, enablePush, isInstalled, playRestEnd, pushState, resetPushCache, sendTestPush, setSoundOn, soundOn } from "../lib/restAlert";

export default function RestAlertSettings() {
  const [sound, setSound] = useState(soundOn);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { pushState().then(setPush).catch(() => setPush("unsupported")); }, []);

  async function run(f: () => Promise<PushState | void>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const s = await f();
      if (s) setPush(s);
      resetPushCache();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2 style={{ paddingTop: 10 }}>Rest timer alerts</h2>
      <label className="toggle" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setSoundOn(e.target.checked); }} />
        <span>Beep when rest ends<span className="small muted" style={{ display: "block" }}>Three short beeps and a buzz while the app is open. Buzz only when off.</span></span>
      </label>
      <button type="button" className="link small" style={{ marginTop: 6, marginLeft: 32 }} onClick={() => playRestEnd(true)}>Play the beep</button>

      <div className="panel" style={{ marginTop: 12 }}>
        <p><strong>When the app is minimised</strong></p>
        {push === null ? (
          <p className="muted small">Checking…</p>
        ) : push === "unsupported" ? (
          <p className="small muted">This browser can't receive notifications. On Android, open Training Log from its home-screen icon in Chrome.</p>
        ) : push === "denied" ? (
          <p className="small">Notifications are blocked for this app. Allow them in your phone's settings (Apps › Training Log › Notifications, or Chrome › Site settings), then come back here.</p>
        ) : push === "on" ? (
          <>
            <p className="small"><span className="chip in">On</span> If you leave the app mid-rest, you'll get a notification with your phone's sound when the rest ends, usually within a couple of seconds.</p>
            <div className="tpl-foot" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { const n = await sendTestPush(); if (!n) throw new Error("No device registered. Turn it off and on again."); }, "Test sent. It should arrive in a moment.")}>Send a test</button>
              <button type="button" className="link small" disabled={busy} onClick={() => run(disablePush, "Turned off.")}>Turn off</button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">Your phone pauses the app when it's minimised, so the alert comes as a notification sent at the end of your rest.{!isInstalled() ? " Works best from the home-screen icon." : ""}</p>
            <button type="button" className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => run(enablePush, "On. Try a test to hear it.")}>{busy ? "Setting up…" : "Turn on notifications"}</button>
          </>
        )}
        {msg && <p className={msg.ok ? "ok small" : "error"} style={{ marginTop: 8 }}>{msg.text}</p>}
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>Tip: if notifications arrive silently, long-press one and set Training Log's notifications to "Alerting" with sound.</p>
    </section>
  );
}
