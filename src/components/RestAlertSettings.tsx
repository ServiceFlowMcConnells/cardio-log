import { useState } from "react";
import { playRestEnd, setSoundOn, soundOn } from "../lib/restAlert";
import { inAndroidApp } from "../lib/nativeTimer";

export default function RestAlertSettings() {
  const [sound, setSound] = useState(soundOn);
  return (
    <section className="section">
      <h2 style={{ paddingTop: 10 }}>Rest timer alert</h2>
      <label className="toggle" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setSoundOn(e.target.checked); }} />
        <span>Sound when rest ends<span className="small muted" style={{ display: "block" }}>{inAndroidApp()
          ? "The Android app shows a live countdown in your notifications and alerts you at the end, even when minimised. Vibrate only when off."
          : "Three short beeps and a buzz while the app is open. Buzz only when off."}</span></span>
      </label>
      {!inAndroidApp() && <button type="button" className="link small" style={{ marginTop: 6, marginLeft: 32 }} onClick={() => playRestEnd(true)}>Play the beep</button>}
    </section>
  );
}
