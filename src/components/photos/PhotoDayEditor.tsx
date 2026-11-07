import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Cropped, PhotoDay, Pose } from "../../lib/photos";
import { POSES, POSE_LABEL, deleteDay, moveDay, saveDay, useSignedUrls } from "../../lib/photos";
import { todayYmd, fromYmd } from "../../lib/nutrition";
import { DateSheet } from "../food/Pickers";
import PhotoCrop from "./PhotoCrop";

/** Add or edit one day's progress photos: a date, and Front / Side / Back slots (upload or take, then crop). */
export default function PhotoDayEditor({ open, day: initialDay, existing, days, onClose, onSaved }: {
  open: boolean;
  day: string;
  existing: PhotoDay | null;
  /** Days that already have photos (to stop moving onto one). */
  days: Set<string>;
  onClose: () => void;
  onSaved?: (text: string) => void;
}) {
  const [day, setDay] = useState(initialDay);
  const [changes, setChanges] = useState<Partial<Record<Pose, Cropped | null>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Pose, string>>>({});
  const [menu, setMenu] = useState<Pose | null>(null);
  const [crop, setCrop] = useState<{ pose: Pose; file: File } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const upload = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const pending = useRef<Pose | null>(null);

  useEffect(() => {
    if (!open) return;
    setDay(initialDay); setChanges({}); setPreviews({}); setMenu(null); setCrop(null); setError(null); setBusy(false); setConfirmDel(false);
  }, [open, initialDay]);

  const thumbs = useSignedUrls(existing ? POSES.map((p) => existing.photos[p]?.thumb_path).filter((x): x is string => !!x) : []);
  const shown = (p: Pose) => (p in changes ? (changes[p] ? previews[p] : null) : existing?.photos[p] ? thumbs.get(existing.photos[p]!.thumb_path) || "" : null);
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

  const dirty = Object.keys(changes).length > 0 || day !== (existing?.day ?? initialDay);
  const clash = existing ? day !== existing.day && days.has(day) : days.has(day);
  const canSave = !busy && dirty && !clash && (POSES.some(has));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let base = existing;
      if (existing && day !== existing.day) { await moveDay(existing.day, day); base = { ...existing, day }; }
      if (Object.keys(changes).length) await saveDay(day, changes, base);
      onClose();
      onSaved?.(`Progress photos saved for ${label(day).toLowerCase()}`);
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
      <div className={`sheet-backdrop photo-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
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
                  {u ? <img src={u} alt="" /> : u === "" ? <span className="photo-ph" /> : <PoseIcon pose={p} />}
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
          {clash && <p className="small error" style={{ margin: 0 }}>{label(day)} already has photos. Pick another date, or edit that day instead.</p>}
          {error && <p className="small error" style={{ margin: 0 }}>{error}</p>}
          <button className="btn primary block" disabled={!canSave} onClick={save} tabIndex={open ? 0 : -1}>{busy ? "Saving…" : "Save"}</button>
          <p className="small muted" style={{ margin: 0, textAlign: "center" }}>Same spot, light and time of day each week makes the comparison fair. Photos are private to you.</p>
        </div>
        <input ref={upload} type="file" accept="image/*" hidden onChange={onFile} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      </div>
      {crop && (
        <PhotoCrop file={crop.file} pose={crop.pose} onCancel={() => setCrop(null)}
          onDone={(c, preview) => { setChanges((x) => ({ ...x, [crop.pose]: c })); setPreviews((x) => ({ ...x, [crop.pose]: preview })); setCrop(null); }} />
      )}
      <DateSheet open={dateOpen} value={day} max={todayYmd()} onPick={setDay} onClose={() => setDateOpen(false)} title="Photo date" />
    </>,
    document.body,
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
