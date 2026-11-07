import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CropJob, Cropped, PhotoDay, Pose } from "../../lib/photos";
import { POSES, POSE_LABEL, deleteDay, saveDay, useSignedUrls } from "../../lib/photos";
import { todayYmd, fromYmd } from "../../lib/nutrition";
import { DateSheet } from "../food/Pickers";
import PhotoCrop from "./PhotoCrop";

/** Add or edit one day's progress photos: a date, and Front / Side / Back slots (upload or take, then crop). */
export default function PhotoDayEditor({ open, day: initialDay, all, onClose, onSaved }: {
  open: boolean;
  day: string;
  /** Every day with photos: the slots show whichever date is picked. */
  all: PhotoDay[];
  onClose: () => void;
  onSaved?: (text: string) => void;
}) {
  const [day, setDay] = useState(initialDay);
  const [changes, setChanges] = useState<Partial<Record<Pose, CropJob | null>>>({});
  const [menu, setMenu] = useState<Pose | null>(null);
  const [crop, setCrop] = useState<{ pose: Pose; file: File } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const upload = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const pending = useRef<Pose | null>(null);

  const existing = all.find((d) => d.day === day) ?? null;
  const jobs = useRef<CropJob[]>([]);
  const dropJobs = () => { jobs.current.forEach((j) => URL.revokeObjectURL(j.src)); jobs.current = []; };
  useEffect(() => dropJobs, []);
  const reset = () => { dropJobs(); setChanges({}); setMenu(null); setCrop(null); setError(null); setBusy(false); setConfirmDel(false); };
  useEffect(() => {
    if (!open) return;
    setDay(initialDay); reset();
  }, [open, initialDay]);
  // Picking another date edits that day instead (its own photos, or empty slots)
  const pickDate = (d: string) => { if (d !== day) { setDay(d); reset(); } };
  // A tap that lands on the backdrop just after the crop screen closes shouldn't close this too
  const guard = useRef(0);
  const closeFromBackdrop = () => { if (!crop && !dateOpen && !busy && Date.now() - guard.current > 700) onClose(); };

  const thumbs = useSignedUrls(existing ? POSES.map((p) => existing.photos[p]?.thumb_path).filter((x): x is string => !!x) : []);
  const shown = (p: Pose): string | CropJob | null => (p in changes ? changes[p] ?? null : existing?.photos[p] ? thumbs.get(existing.photos[p]!.thumb_path) || "" : null);
  const has = (p: Pose) => shown(p) != null;

  const pick = (p: Pose, how: "upload" | "camera") => {
    pending.current = p;
    setMenu(null);
    (how === "camera" ? camera : upload).current?.click();
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f && pending.current) setCrop({ pose: pending.current, file: f });
  };

  const dirty = Object.keys(changes).length > 0;
  const canSave = !busy && dirty;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const out: Partial<Record<Pose, Cropped | null>> = {};
      for (const [p, j] of Object.entries(changes) as [Pose, CropJob | null][]) out[p] = j ? await j.result : null;
      await saveDay(day, out, existing);
      onClose();
      onSaved?.(day === todayYmd() ? "Today's progress photos saved" : `Progress photos saved for ${fromYmd(day).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photos.");
      setBusy(false);
    }
  }
  async function remove() {
    if (!existing) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true);
    try { await deleteDay(existing); onClose(); onSaved?.("Progress photos deleted"); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete."); setBusy(false); }
  }

  const label = (d: string) => (d === todayYmd() ? "Today" : fromYmd(d).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));

  return createPortal(
    <>
      <div className={`sheet-backdrop photo-backdrop${open ? " open" : ""}`} onClick={closeFromBackdrop} aria-hidden="true" />
      <div className={`sheet photo-sheet${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Progress photos" aria-hidden={!open}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="icon-btn sheet-x" aria-label="Close" onClick={onClose} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <button type="button" className="weigh-date" onClick={() => setDateOpen(true)} tabIndex={open ? 0 : -1} aria-label={`Date: ${label(day)}. Change`}>
            <span className="weigh-date-main">{label(day)} <span aria-hidden="true">▾</span></span>
            <span className="small muted">Progress photos</span>
          </button>
          <button type="button" className={`icon-btn${confirmDel ? " danger" : ""}`} aria-label={confirmDel ? "Tap again to delete this day's photos" : "Delete this day's photos"} disabled={!existing || busy} onClick={remove} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
          </button>
        </div>
        <div className="photo-slots">
          {POSES.map((p) => {
            const u = shown(p);
            return (
              <div key={p} className="photo-slot-wrap">
                <span className="small">{POSE_LABEL[p]}</span>
                <button type="button" className={`photo-slot${u != null ? " full" : ""}${menu === p ? " on" : ""}`} onClick={() => setMenu(menu === p ? null : p)} tabIndex={open ? 0 : -1}
                  aria-label={`${POSE_LABEL[p]} photo${u != null ? " (added). Change" : ". Add"}`}>
                  {u && typeof u === "object" ? <CropPreview job={u} /> : u ? <img src={u} alt="" /> : u === "" ? <span className="photo-ph" /> : <PoseIcon pose={p} />}
                </button>
              </div>
            );
          })}
        </div>
        {menu && (
          <div className="photo-menu">
            <button onClick={() => pick(menu, "upload")}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4h16v-4" /></svg>
              Upload photo
            </button>
            <button onClick={() => pick(menu, "camera")}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Take photo
            </button>
            {has(menu) && (
              <button className="danger" onClick={() => { setChanges((c) => ({ ...c, [menu]: null })); setMenu(null); }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                Remove {POSE_LABEL[menu].toLowerCase()} photo
              </button>
            )}
          </div>
        )}
        <div className="photo-foot">
          {error && <p className="small error" style={{ margin: 0 }}>{error}</p>}
          <button className="btn primary block" disabled={!canSave} onClick={save} tabIndex={open ? 0 : -1}>{busy ? "Saving…" : "Save"}</button>
          <p className="small muted" style={{ margin: 0, textAlign: "center" }}>Same spot, light and time of day each week makes the comparison fair. Photos are private to you.</p>
        </div>
        <input ref={upload} type="file" accept="image/*" hidden onChange={onFile} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      </div>
      {crop && (
        <PhotoCrop file={crop.file} pose={crop.pose} onCancel={() => { guard.current = Date.now(); setCrop(null); }}
          onDone={(job) => { guard.current = Date.now(); jobs.current.push(job); setChanges((x) => ({ ...x, [crop.pose]: job })); setCrop(null); }} />
      )}
      <DateSheet open={dateOpen} value={day} max={todayYmd()} onPick={pickDate} onClose={() => { guard.current = Date.now(); setDateOpen(false); }} title={dirty ? "Photo date (unsaved changes will be dropped)" : "Photo date"} />
    </>,
    document.body,
  );
}

/** The accepted crop, drawn from the source photo with the same transform as the crop screen, scaled to the slot. */
function CropPreview({ job }: { job: CropJob }) {
  const box = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => { setW(box.current?.clientWidth ?? 0); }, []);
  const k = w / job.fw;
  return (
    <span ref={box} className="photo-crop-prev">
      {w > 0 && (
        <span style={{ position: "absolute", left: "50%", top: "50%", width: job.fw, height: job.fw * 1.25, overflow: "hidden", transform: `translate(-50%, -50%) scale(${k})` }}>
          <img src={job.src} alt="" className="crop-img" style={{ width: job.nw, height: job.nh, marginLeft: -job.nw / 2, marginTop: -job.nh / 2, objectFit: "fill",
            transform: `translate(${job.ox}px, ${job.oy}px) rotate(${job.rot}deg) scale(${job.scale})` }} />
        </span>
      )}
    </span>
  );
}

export function PoseIcon({ pose }: { pose: Pose }) {
  // Simple standing figures: arms out (front/back), profile (side)
  return pose === "side" ? (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.5" r="2.2" /><path d="M10.6 8h2.6l.9 5.2-1.4.4.6 8.4h-2l-.4-6.3-.8 6.3h-2l1.1-8.4-.5-.3z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.5" r="2.2" /><path d="M5 8.2h14v1.8l-4.3.7.3 5-1 6.3h-1.9L12 16l-.1 6h-1.9l-1-6.3.3-5L5 10z" /></svg>
  );
}
