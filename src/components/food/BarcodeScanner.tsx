import { useEffect, useRef, useState } from "react";
import { getDetector, validBarcode } from "../../lib/barcode";
import { inAndroidApp } from "../../lib/nativeTimer";
import { useBackHandler } from "../../lib/backNav";

/** Full-screen camera that reads an EAN/UPC barcode, with typing the number as a fallback. */
export default function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [torch, setTorch] = useState<null | { on: boolean; track: MediaStreamTrack }>(null);
  useBackHandler(true, onClose);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera"), { name: "NotSupportedError" });
        const [det, s] = await Promise.all([
          getDetector(),
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
        ]);
        stream = s;
        if (stopped) return;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        setStatus("scanning");
        const track = s.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as unknown as { torch?: boolean };
        if (caps.torch) setTorch({ on: false, track });
        const tick = async () => {
          if (stopped) return;
          try {
            if (v.readyState >= 2) {
              const hit = (await det.detect(v)).find((r) => validBarcode(r.rawValue));
              if (hit && !stopped) {
                stopped = true;
                navigator.vibrate?.(60);
                onCode(hit.rawValue);
                return;
              }
            }
          } catch { /* a frame that couldn't be read */ }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        if (stopped) return;
        const name = (e as { name?: string }).name;
        setStatus("error");
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? inAndroidApp()
              ? "The app couldn't use the camera. Install the latest Training Log app (1.0.5 or later), then allow the camera when asked. Or type the number below."
              : "Camera access was blocked. Allow the camera for this site, or type the number below."
            : name === "NotFoundError" || name === "NotSupportedError"
              ? "No camera found. Type the number under the barcode instead."
              : "Couldn't start the barcode reader. Check your connection, or type the number below.",
        );
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleTorch() {
    if (!torch) return;
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as unknown as MediaTrackConstraintSet] });
      setTorch({ ...torch, on: !torch.on });
    } catch { /* not supported after all */ }
  }

  const code = typed.replace(/\D/g, "");
  return (
    <div className="scanner" role="dialog" aria-label="Scan a barcode">
      <video ref={video} className="scanner-video" playsInline muted />
      <div className="scanner-frame" aria-hidden="true"><span /></div>
      <div className="scanner-top">
        <button className="btn dark" onClick={onClose}>Cancel</button>
        {torch && <button className={`btn ${torch.on ? "primary" : "dark"}`} onClick={toggleTorch}>{torch.on ? "Light off" : "Light"}</button>}
      </div>
      <div className="scanner-bottom">
        <p className="small">{status === "starting" ? "Starting the camera…" : status === "scanning" ? "Line the barcode up inside the box." : error}</p>
        <form className="scanner-type" onSubmit={(e) => { e.preventDefault(); if (validBarcode(code)) onCode(code); }}>
          <input className="input" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type the barcode number" aria-label="Barcode number" />
          <button className="btn primary" disabled={!validBarcode(code)}>Look up</button>
        </form>
        {code.length >= 8 && !validBarcode(code) && <p className="small" style={{ marginTop: 6 }}>That number doesn't check out. Check the digits.</p>}
      </div>
    </div>
  );
}
