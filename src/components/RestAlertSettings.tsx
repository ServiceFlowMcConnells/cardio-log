import { useState } from "react";
import { playRestEnd, setSoundOn, soundOn } from "../lib/restAlert";
import { inAndroidApp, nativeRestTimer } from "../lib/nativeTimer";

export default function RestAlertSettings() {
  const [sound, setSound] = useState(soundOn);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const native = nativeRestTimer();

  async function testNative() {
    if (!native) return;
    setMsg(null);
    try {
      const perm = await native.requestPermission();
      if (!perm.granted) {
        setMsg({ ok: false, text: "Notifications are off for Training Log. Turn them on in your phone's Settings › Apps › Training Log › Notifications, then try again." });
        return;
      }
      const r = await native.start({ endAt: Date.now() + 10_000, title: "Test rest", body: "Rest timer test", sound });
      setMsg({ ok: true, text: `Started a 10-second rest. Minimise the app: the countdown is in your notifications and it alerts at zero.${r.exact === false ? " (Exact alarms are restricted on this phone, so the alert may be a few seconds late.)" : ""}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "The rest timer didn't start." });
    }
  }

  return (
    <section className="section">
      <h2 style={{ paddingTop: 10 }}>Rest timer alert</h2>
      <label className="toggle" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setSoundOn(e.target.checked); }} />
        <span>Sound when rest ends<span className="small muted" style={{ display: "block" }}>{inAndroidApp()
          ? "The Android app shows a live countdown in your notifications and alerts you at the end, even when minimised. Vibrate only when off."
          : "Three short beeps and a buzz while the app is open. Buzz only when off."}</span></span>
      </label>
      {native
        ? <button type="button" className="btn ghost" style={{ marginTop: 10, marginLeft: 32 }} onClick={testNative}>Test: 10-second rest</button>
        : <button type="button" className="link small" style={{ marginTop: 6, marginLeft: 32 }} onClick={() => playRestEnd(true)}>Play the beep</button>}
      {msg && <p className={msg.ok ? "ok small" : "error"} style={{ marginTop: 8, marginLeft: 32 }}>{msg.text}</p>}
    </section>
  );
}
