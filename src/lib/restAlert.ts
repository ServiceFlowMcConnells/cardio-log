// Rest timer alert: a short beep + buzz when the rest hits zero while the app is open
// (Web Audio, unlocked by tapping a set).
const SOUND_KEY = "training-log:rest-sound";

// ---------- Sound ----------

let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* ignore */ }
}

/** Call from a tap (e.g. ticking a set) so the browser lets us play sound later. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch { /* no audio */ }
}

/** Three short rising beeps, then a buzz. */
export function playRestEnd(test = false) {
  try { navigator.vibrate?.([200, 100, 200, 100, 300]); } catch { /* not supported */ }
  if (!test && !soundOn()) return;
  try {
    unlockAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [880, 0.22], [1320, 0.44]].forEach(([f, at], i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = t0 + at, len = i === 2 ? 0.32 : 0.14;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      o.connect(g).connect(ctx!.destination);
      o.start(s);
      o.stop(s + len + 0.02);
    });
  } catch { /* no audio */ }
}
