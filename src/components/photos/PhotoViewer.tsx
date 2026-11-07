import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoDay, Pose, ProgressPhoto } from "../../lib/photos";
import { POSES, POSE_LABEL, useSignedUrls } from "../../lib/photos";
import type { BodyWeight } from "../../lib/nutrition";
import { fromYmd, trendWeights } from "../../lib/nutrition";

/** Full-screen photo viewer, MacroFactor style: Front / Side / Back, one photo or two dates compared, Trend and
 *  Scale weight for each, a filmstrip to pick dates and a background tinted to the photo. */
export default function PhotoViewer({ days, weights, start, compare: compare0, onClose, onEdit }: {
  days: PhotoDay[]; // newest first
  weights: BodyWeight[];
  start?: string;
  compare?: boolean;
  onClose: () => void;
  onEdit: (d: PhotoDay) => void;
}) {
  const [pose, setPose] = useState<Pose>(() => (POSES.find((p) => days.find((d) => d.day === start)?.photos[p]) ?? "front"));
  const [compare, setCompare] = useState(Boolean(compare0));
  // Days (oldest → newest, like the filmstrip) that have this pose
  const list = useMemo(() => days.filter((d) => d.photos[pose]).map((d) => d.photos[pose]!).sort((a, b) => a.taken_on.localeCompare(b.taken_on)), [days, pose]);
  const [top, setTop] = useState<string | null>(start ?? null); // the newer photo (or the only one)
  const [bottom, setBottom] = useState<string | null>(null); // the earlier photo in compare
  const [active, setActive] = useState<"top" | "bottom">("top");

  // Keep both picks on days that have this pose: top defaults to the latest, bottom to the first
  useEffect(() => {
    if (!list.length) return;
    const ok = (d: string | null) => d != null && list.some((p) => p.taken_on === d);
    if (!ok(top)) setTop(nearest(list, top) ?? list[list.length - 1].taken_on);
    if (!ok(bottom)) setBottom(list[0].taken_on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const trend = useMemo(() => new Map(trendWeights(weights).map((t) => [t.day, t])), [weights]);
  const scale = useMemo(() => new Map(weights.map((w) => [w.measured_on, w.weight_kg])), [weights]);
  const photoOn = (d: string | null) => list.find((p) => p.taken_on === d) ?? null;
  const a = photoOn(top), b = compare ? photoOn(bottom) : null;
  const shown = [a, b].filter((x): x is ProgressPhoto => !!x);
  const full = useSignedUrls(shown.map((p) => p.path));
  const thumbs = useSignedUrls(list.map((p) => p.thumb_path));
  const cur = active === "bottom" && compare ? b : a;
  const tint = cur?.tint ?? "#1b2429";

  const step = (dir: -1 | 1) => {
    const d = active === "bottom" && compare ? bottom : top;
    const i = list.findIndex((p) => p.taken_on === d);
    const n = list[Math.max(0, Math.min(list.length - 1, i + dir))];
    if (!n) return;
    if (active === "bottom" && compare) setBottom(n.taken_on); else setTop(n.taken_on);
  };
  const pickDay = (d: string) => (active === "bottom" && compare ? setBottom(d) : setTop(d));

  // Keep the picked thumbnail in view
  const strip = useRef<HTMLDivElement>(null);
  const pickedDay = active === "bottom" && compare ? bottom : top;
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-day="${pickedDay}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pickedDay, pose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const card = (p: ProgressPhoto | null, which: "top" | "bottom") => {
    if (!p) return <div className="pv-card empty"><p className="muted small">No {POSE_LABEL[pose].toLowerCase()} photo</p></div>;
    const t = trend.get(p.taken_on)?.trend ?? null, sc = scale.get(p.taken_on) ?? null;
    return (
      <button className={`pv-card${compare ? " compare" : ""}${compare && active === which ? " on" : ""}`} onClick={() => setActive(which)} aria-pressed={compare ? active === which : undefined}
        aria-label={`${fmtLong(p.taken_on)}${compare ? (active === which ? ", selected" : ". Select to change this date") : ""}`}>
        <strong className="pv-date">{fmtLong(p.taken_on)}</strong>
        <span className="pv-body">
          <span className="pv-img">{full.get(p.path) ? <img src={full.get(p.path)} alt={`${POSE_LABEL[pose]} photo, ${fmtLong(p.taken_on)}`} /> : thumbs.get(p.thumb_path) ? <img src={thumbs.get(p.thumb_path)} alt="" /> : null}</span>
          <span className="pv-w">
            <span>Trend weight: <b>{t != null ? `${t.toFixed(1)} kg` : "–"}</b></span>
            <span>Scale weight: <b>{sc != null ? `${sc.toFixed(1)} kg` : "–"}</b></span>
          </span>
        </span>
      </button>
    );
  };
  const diff = a && b ? (() => {
    const ta = trend.get(a.taken_on)?.trend, tb = trend.get(b.taken_on)?.trend;
    const days = Math.round((fromYmd(a.taken_on).getTime() - fromYmd(b.taken_on).getTime()) / 86400000);
    return ta != null && tb != null ? `${Math.abs(days)} days apart · trend ${ta - tb >= 0 ? "+" : "−"}${Math.abs(ta - tb).toFixed(1)} kg` : `${Math.abs(days)} days apart`;
  })() : null;

  return createPortal(
    <div className="pv" style={{ background: tint }} role="dialog" aria-modal="true" aria-label="Progress photos">
      <div className="pv-top">
        <button className="icon-btn" aria-label="Back" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="seg pv-seg" role="group" aria-label="Pose">
          {POSES.map((p) => <button key={p} className={pose === p ? "on" : ""} aria-pressed={pose === p} onClick={() => setPose(p)}>{POSE_LABEL[p]}</button>)}
        </div>
        <span style={{ width: 40 }} />
      </div>

      <div className={`pv-main${compare ? " two" : ""}`}>
        {!list.length ? <p className="muted" style={{ textAlign: "center" }}>No {POSE_LABEL[pose].toLowerCase()} photos yet.</p> : compare ? (
          <>
            {card(a, "top")}
            {diff && <p className="pv-diff small">{diff}</p>}
            {card(b, "bottom")}
          </>
        ) : card(a, "top")}
      </div>

      <div className="pv-strip" ref={strip} role="listbox" aria-label="Dates">
        {list.map((p) => (
          <button key={p.id} data-day={p.taken_on} role="option" aria-selected={p.taken_on === pickedDay}
            className={`pv-thumb${p.taken_on === pickedDay ? " on" : ""}${compare && p.taken_on === (active === "top" ? bottom : top) ? " other" : ""}`}
            onClick={() => pickDay(p.taken_on)} aria-label={fmtLong(p.taken_on)}>
            {thumbs.get(p.thumb_path) ? <img src={thumbs.get(p.thumb_path)} alt="" /> : null}
          </button>
        ))}
      </div>

      <div className="pv-bar">
        <span style={{ width: 44 }} />
        <button className="icon-btn" aria-label="Earlier" onClick={() => step(-1)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button className="pv-mode" aria-label={compare ? "Show one photo" : "Compare two dates"} aria-pressed={compare} onClick={() => { setCompare((c) => !c); setActive("top"); }}>
          {compare ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="14" height="7" rx="2" /><rect x="5" y="13" width="14" height="7" rx="2" /></svg>
          )}
        </button>
        <button className="icon-btn" aria-label="Later" onClick={() => step(1)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
        <button className="icon-btn" aria-label="Edit this day's photos" disabled={!cur} onClick={() => { const d = days.find((x) => x.day === cur?.taken_on); if (d) onEdit(d); }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}

const fmtLong = (d: string) => fromYmd(d).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
const nearest = (list: ProgressPhoto[], d: string | null) => {
  if (!d || !list.length) return null;
  const t = fromYmd(d).getTime();
  return list.reduce((m, p) => (Math.abs(fromYmd(p.taken_on).getTime() - t) < Math.abs(fromYmd(m.taken_on).getTime() - t) ? p : m)).taken_on;
};
