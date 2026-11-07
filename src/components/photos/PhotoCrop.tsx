import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CropJob, Pose } from "../../lib/photos";
import { POSE_LABEL, loadImage, renderCrop } from "../../lib/photos";

/** Full-screen crop to the 4:5 frame (MacroFactor style): drag to move, pinch or the slider to zoom, ↻ to rotate. */
export default function PhotoCrop({ file, pose, onDone, onCancel }: { file: File; pose: Pose; onDone: (job: CropJob) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [src, setSrc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [rot, setRot] = useState(0);
  const [zoom, setZoom] = useState(1); // 1 = just covers the frame
  const [off, setOff] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const [fw, setFw] = useState(300);

  const handed = useRef(false); // once accepted, the editor owns the photo's link
  useEffect(() => {
    const u = URL.createObjectURL(file);
    let live = true;
    setSrc(u);
    loadImage(u).then((i) => { if (live) setImg(i); }).catch((e) => setErr(e.message));
    return () => { live = false; if (!handed.current) URL.revokeObjectURL(u); };
  }, [file]);

  // Frame size: as large as fits, 4:5
  useLayoutEffect(() => {
    const measure = () => {
      const el = stage.current;
      if (!el) return;
      const w = el.clientWidth - 24, h = el.clientHeight - 24;
      setFw(Math.max(160, Math.min(w, h * 0.8)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const fh = fw * 1.25;

  // Image size as rotated, and the scale that just covers the frame
  const side = rot % 180 !== 0;
  const iw = img ? (side ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (side ? img.naturalWidth : img.naturalHeight) : 1;
  const base = Math.max(fw / iw, fh / ih);
  const s = base * zoom;
  const clamp = (x: number, y: number) => {
    const mx = Math.max(0, (iw * s - fw) / 2), my = Math.max(0, (ih * s - fh) / 2);
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  useEffect(() => { setOff((o) => clamp(o.x, o.y)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [zoom, rot, fw, img]);

  // Drag and pinch
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g0 = useRef<{ off: { x: number; y: number }; zoom: number; d: number; c: { x: number; y: number } } | null>(null);
  const gesture = () => {
    const p = [...pts.current.values()];
    const c = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0];
    const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
    return { c, d };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { c, d } = gesture();
    g0.current = { off, zoom, d, c };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g0.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { c, d } = gesture();
    const z = g0.current.d && d ? Math.max(1, Math.min(4, (g0.current.zoom * d) / g0.current.d)) : g0.current.zoom;
    if (z !== zoom) setZoom(z);
    const k = z / g0.current.zoom; // keep the point under the fingers where it was
    setOff(clampAt(z, g0.current.off.x * k + (c.x - g0.current.c.x), g0.current.off.y * k + (c.y - g0.current.c.y)));
  };
  const clampAt = (z: number, x: number, y: number) => {
    const sz = base * z;
    const mx = Math.max(0, (iw * sz - fw) / 2), my = Math.max(0, (ih * sz - fh) / 2);
    return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    const { c, d } = pts.current.size ? gesture() : { c: { x: 0, y: 0 }, d: 0 };
    g0.current = pts.current.size ? { off, zoom, d, c } : null;
  };

  // Accept straight away; the JPEGs render after the crop screen has closed
  const done = () => {
    if (!img || handed.current) return;
    handed.current = true;
    const job = { src, nw: img.naturalWidth, nh: img.naturalHeight, rot, scale: s, ox: off.x, oy: off.y, fw };
    const result = new Promise<void>((r) => setTimeout(r, 350)).then(() => renderCrop(img, rot, s, off.x, off.y, fw));
    result.catch(() => { /* reported when saving */ });
    onDone({ ...job, result });
  };

  return createPortal(
    <div className="crop" role="dialog" aria-modal="true" aria-label={`Crop ${POSE_LABEL[pose].toLowerCase()} photo`}>
      <div className="crop-bar">
        <button className="icon-btn" aria-label="Cancel" onClick={onCancel}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <strong>Crop {POSE_LABEL[pose].toLowerCase()} photo</strong>
        <button className="icon-btn" aria-label="Use this crop" disabled={!img} onClick={done}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>
      </div>
      <div className="crop-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {err ? <p className="error">{err}</p> : !img ? <p className="muted">Opening…</p> : (
          <>
            <img src={src} alt="" draggable={false} className="crop-img"
              style={{ width: img.naturalWidth, height: img.naturalHeight, marginLeft: -img.naturalWidth / 2, marginTop: -img.naturalHeight / 2,
                transform: `translate(${off.x}px, ${off.y}px) rotate(${rot}deg) scale(${s})` }} />
            <div className="crop-frame" style={{ width: fw, height: fh }}>
              <span className="crop-grid v1" /><span className="crop-grid v2" /><span className="crop-grid h1" /><span className="crop-grid h2" />
            </div>
          </>
        )}
      </div>
      <div className="crop-tools">
        <label className="crop-zoom">
          <span className="num">{Math.round(zoom * 100)}%</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        </label>
        <div className="crop-btns">
          <button className="icon-btn" aria-label="Rotate 90 degrees" onClick={() => { setRot((r) => (r + 90) % 360); setOff({ x: 0, y: 0 }); }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
          </button>
          <button className="link small" onClick={() => { setZoom(1); setOff({ x: 0, y: 0 }); }}>Reset</button>
          <span className="small muted">Line up your feet and head with the grid the same way each time</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
