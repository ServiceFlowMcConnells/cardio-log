// Progress photos: front, side and back per day, kept in a private Supabase Storage bucket. Images are cropped on
// the phone to 4:5 (1080 × 1350) with a small thumbnail for lists, and shown through short-lived signed links.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Pose = "front" | "side" | "back";
export const POSES: Pose[] = ["front", "side", "back"];
export const POSE_LABEL: Record<Pose, string> = { front: "Front", side: "Side", back: "Back" };

export interface ProgressPhoto { id: string; taken_on: string; pose: Pose; path: string; thumb_path: string; tint: string | null }
/** One day's set: up to one photo per pose. */
export interface PhotoDay { day: string; photos: Partial<Record<Pose, ProgressPhoto>> }

const BUCKET = "progress-photos";
export const OUT_W = 1080, OUT_H = 1350, THUMB_W = 240, THUMB_H = 300;

// ---------- store: loaded once, shared by the list, the viewer and the Weight page card ----------
let cache: ProgressPhoto[] | null = null;
let loading: Promise<ProgressPhoto[]> | null = null;
const subs = new Set<(p: ProgressPhoto[]) => void>();
const emit = () => subs.forEach((f) => f(cache ?? []));

export async function loadPhotos(force = false): Promise<ProgressPhoto[]> {
  if (cache && !force) return cache;
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from("progress_photos").select("id, taken_on, pose, path, thumb_path, tint").order("taken_on", { ascending: false });
    if (error) throw error;
    cache = [...((data ?? []) as ProgressPhoto[])];
    emit();
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

export function usePhotos(): { photos: ProgressPhoto[] | null; error: string | null; reload: () => void } {
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    subs.add(setPhotos);
    loadPhotos().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load photos."));
    return () => { subs.delete(setPhotos); };
  }, []);
  return { photos, error, reload: () => { loadPhotos(true).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load photos.")); } };
}

/** Days with photos, newest first. */
export function byDay(photos: ProgressPhoto[]): PhotoDay[] {
  const m = new Map<string, PhotoDay>();
  for (const p of photos) {
    const d = m.get(p.taken_on) ?? { day: p.taken_on, photos: {} };
    d.photos[p.pose] = p;
    m.set(p.taken_on, d);
  }
  return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
}

// ---------- signed links (cached until shortly before they expire) ----------
const urls = new Map<string, { url: string; exp: number }>();
const TTL = 3600;
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !p.startsWith("blob:")).filter((p) => { const u = urls.get(p); return !u || u.exp < now + 60_000; });
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, TTL);
    if (error) throw error;
    for (const d of data ?? []) if (d.signedUrl && d.path) urls.set(d.path, { url: d.signedUrl, exp: now + TTL * 1000 });
  }
  return new Map(paths.map((p) => [p, p.startsWith("blob:") ? p : urls.get(p)?.url ?? ""]));
}
/** Signed links for these paths, filled in as they arrive. */
export function useSignedUrls(paths: string[]): Map<string, string> {
  const key = paths.join("|");
  const [m, setM] = useState<Map<string, string>>(() => new Map(paths.map((p) => [p, p.startsWith("blob:") ? p : urls.get(p)?.url ?? ""])));
  useEffect(() => {
    let live = true;
    if (paths.length) signedUrls(paths).then((r) => { if (live) setM(r); }).catch(() => { /* shows the placeholder */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}

// ---------- saving ----------
export interface Cropped { full: Blob; thumb: Blob; tint: string }
/** A crop the user has accepted: shown straight away from the source photo with CSS, while the JPEGs render in
 *  the background (they're only needed when Save is tapped). */
export interface CropJob { src: string; img: HTMLImageElement; nw: number; nh: number; rot: number; scale: number; ox: number; oy: number; fw: number; result: Promise<Cropped> }

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("You're signed out. Sign in again.");
  return data.user.id;
}

/** Shows a day's changes in the list and viewer straight away (from local copies) while they upload. */
export function showLocally(day: string, changes: Partial<Record<Pose, Cropped | null>>) {
  const keep = (cache ?? []).filter((p) => !(p.taken_on === day && p.pose in changes));
  const add: ProgressPhoto[] = [];
  for (const pose of POSES) {
    const c = changes[pose];
    if (c) add.push({ id: `local-${day}-${pose}`, taken_on: day, pose, path: URL.createObjectURL(c.full), thumb_path: URL.createObjectURL(c.thumb), tint: c.tint });
  }
  cache = [...add, ...keep].sort((a, b) => b.taken_on.localeCompare(a.taken_on));
  emit();
  setTimeout(() => add.forEach((p) => { URL.revokeObjectURL(p.path); URL.revokeObjectURL(p.thumb_path); }), 120_000);
}

/** Saves a day's changes: new or replaced photos, and poses removed. Poses upload side by side. */
export async function saveDay(day: string, changes: Partial<Record<Pose, Cropped | null>>, existing: PhotoDay | null) {
  const uid = await userId();
  const stale: string[] = [];
  await Promise.all(POSES.filter((pose) => pose in changes).map(async (pose) => {
    const c = changes[pose];
    const old = existing?.photos[pose];
    if (old && !old.path.startsWith("blob:")) stale.push(old.path, old.thumb_path);
    if (c === null) {
      if (old && !old.id.startsWith("local-")) { const { error } = await supabase.from("progress_photos").delete().eq("id", old.id); if (error) throw error; }
      return;
    }
    if (!c) return;
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const path = `${uid}/${day}/${pose}-${stamp}.jpg`, thumb = `${uid}/${day}/${pose}-${stamp}-t.jpg`;
    const [up1, up2] = await Promise.all([
      supabase.storage.from(BUCKET).upload(path, c.full, { contentType: "image/jpeg", upsert: true }),
      supabase.storage.from(BUCKET).upload(thumb, c.thumb, { contentType: "image/jpeg", upsert: true }),
    ]);
    if (up1.error) throw up1.error;
    if (up2.error) throw up2.error;
    const { error } = await supabase.from("progress_photos").upsert({ user_id: uid, taken_on: day, pose, path, thumb_path: thumb, tint: c.tint }, { onConflict: "user_id,taken_on,pose" });
    if (error) throw error;
  }));
  if (stale.length) void supabase.storage.from(BUCKET).remove(stale); // best effort, in the background
  await loadPhotos(true);
}

/** Moves a day's photos to another date (the files stay where they are). */
export async function moveDay(from: string, to: string) {
  if (from === to) return;
  const { error } = await supabase.from("progress_photos").update({ taken_on: to }).eq("taken_on", from);
  if (error) throw error;
  await loadPhotos(true);
}

export async function deleteDay(d: PhotoDay) {
  const ps = POSES.map((p) => d.photos[p]).filter((x): x is ProgressPhoto => !!x);
  if (!ps.length) return;
  const { error } = await supabase.from("progress_photos").delete().in("id", ps.map((p) => p.id));
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove(ps.flatMap((p) => [p.path, p.thumb_path]));
  await loadPhotos(true);
}

// ---------- image helpers ----------
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Couldn't open that photo."));
    img.src = src;
  });
}
const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't save the photo."))), "image/jpeg", q));

/** Renders the crop: the image rotated `rot` degrees, scaled by `scale` (screen px per image px) and offset (ox, oy)
 *  from the centre of a frame `fw` px wide, into a 1080 × 1350 JPEG plus thumbnail and average colour. */
export async function renderCrop(img: HTMLImageElement, rot: number, scale: number, ox: number, oy: number, fw: number): Promise<Cropped> {
  // Phone photos are 12 MP+; drawing that full size is what made saving slow. Shrink it first to just the detail the
  // 1080 px output can use (the browser does this off the main thread).
  const f = Math.min(1, (scale * OUT_W) / fw);
  let src: CanvasImageSource = img, sw = img.naturalWidth, sh = img.naturalHeight;
  if (f < 0.95 && typeof createImageBitmap === "function") {
    try {
      const bw = Math.max(1, Math.round(sw * f)), bh = Math.max(1, Math.round(sh * f));
      src = await createImageBitmap(img, { resizeWidth: bw, resizeHeight: bh, resizeQuality: "high" });
      sw = bw; sh = bh;
    } catch { src = img; }
  }
  const per = sw / img.naturalWidth; // bitmap px per source px
  const draw = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    const k = w / fw;
    ctx.translate(w / 2 + ox * k, h / 2 + oy * k);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale((scale * k) / per, (scale * k) / per);
    ctx.drawImage(src, -sw / 2, -sh / 2);
    return c;
  };
  const pause = () => new Promise((r) => setTimeout(r, 0)); // keep the screen responsive between steps
  const thumb = draw(THUMB_W, THUMB_H);
  // Average colour, darkened, for the viewer's background (from a tiny copy: reading pixels is slow on phones)
  const tiny = document.createElement("canvas");
  tiny.width = 12; tiny.height = 15;
  const tctx = tiny.getContext("2d", { willReadFrequently: true })!;
  tctx.drawImage(thumb, 0, 0, 12, 15);
  const px = tctx.getImageData(0, 0, 12, 15).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  const dk = (v: number) => Math.round((v / n) * 0.45).toString(16).padStart(2, "0");
  const thumbBlob = await toBlob(thumb, 0.8);
  await pause();
  const full = draw(OUT_W, OUT_H);
  if (src !== img) (src as ImageBitmap).close?.();
  await pause();
  return { full: await toBlob(full, 0.86), thumb: thumbBlob, tint: `#${dk(r)}${dk(g)}${dk(b)}` };
}
