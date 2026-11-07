import { useMemo, useState } from "react";
import type { BodyWeight } from "../../lib/nutrition";
import { fromYmd, todayYmd } from "../../lib/nutrition";
import type { PhotoDay } from "../../lib/photos";
import { POSES, byDay, usePhotos, useSignedUrls } from "../../lib/photos";
import PhotoDayEditor, { PoseIcon } from "./PhotoDayEditor";
import PhotoViewer from "./PhotoViewer";

/** Progress photos: days grouped by month (front, side, back thumbnails), open the gallery or compare two dates. */
export default function ProgressPhotos({ weights, onBack, startAdd, onToast }: { weights: BodyWeight[]; onBack: () => void; startAdd?: boolean; onToast: (t: string) => void }) {
  const { photos, error } = usePhotos();
  const days = useMemo(() => byDay(photos ?? []), [photos]);
  const [edit, setEdit] = useState<{ day: string } | null>(() => (startAdd ? { day: todayYmd() } : null));
  const [view, setView] = useState<{ start?: string; compare?: boolean } | null>(null);
  const thumbs = useSignedUrls(days.flatMap((d) => POSES.map((p) => d.photos[p]?.thumb_path).filter((x): x is string => !!x)));
  const months = useMemo(() => {
    const m = new Map<string, PhotoDay[]>();
    for (const d of days) m.set(d.day.slice(0, 7), [...(m.get(d.day.slice(0, 7)) ?? []), d]);
    return [...m];
  }, [days]);
  const addNew = () => setEdit({ day: todayYmd() });

  return (
    <>
      <div className="editor-bar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h1 style={{ margin: 0, flex: 1, textAlign: "center", fontSize: "1.3rem" }}>Progress photos</h1>
        <button className="icon-btn" aria-label="Add progress photos" onClick={addNew}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      {days.length > 0 && (
        <div className="chip-row" style={{ margin: "4px 0 14px" }}>
          <button className="fchip" onClick={() => setView({ start: days[0].day })}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 15l4.5-4.5L13 15l3-3 4 4" /></svg>
            Open gallery
          </button>
          <button className="fchip" disabled={days.length < 2} onClick={() => setView({ start: days[0].day, compare: true })}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="13" width="16" height="7" rx="2" /></svg>
            Compare before &amp; after
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {photos == null && !error && <p className="muted">Loading…</p>}
      {photos && !days.length && (
        <section className="panel pp-empty">
          <div className="pp-empty-icons"><PoseIcon pose="front" /><PoseIcon pose="side" /><PoseIcon pose="back" /></div>
          <h2>Start your photo log</h2>
          <p className="muted">Front, side and back once a week, same spot and light. Weight barely moves week to week in a cut; photos show what the scale can't.</p>
          <button className="btn primary" onClick={addNew}>Add today's photos</button>
        </section>
      )}
      {months.map(([m, ds]) => (
        <section key={m} className="section">
          <h2 className="pp-month">{fromYmd(`${m}-01`).toLocaleDateString("en-IE", { month: "long", year: "numeric" })}</h2>
          <div className="panel pp-list">
            {ds.map((d) => (
              <div key={d.day} className="pp-row">
                <button className="pp-open" onClick={() => setView({ start: d.day })} aria-label={`View photos from ${fromYmd(d.day).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}`}>
                  <span className="pp-stack" aria-hidden="true">
                    {POSES.map((p) => {
                      const ph = d.photos[p];
                      const u = ph ? thumbs.get(ph.thumb_path) : null;
                      return <span key={p} className={`pp-av${ph ? "" : " none"}`}>{u ? <img src={u} alt="" /> : ph ? null : <PoseIcon pose={p} />}</span>;
                    })}
                  </span>
                  <span className="pp-date small">{fromYmd(d.day).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</span>
                </button>
                <button className="icon-btn pp-edit" aria-label="Edit these photos" onClick={() => setEdit({ day: d.day })}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <PhotoDayEditor open={!!edit} day={edit?.day ?? todayYmd()} all={days} onClose={() => setEdit(null)} onSaved={onToast} />
      {view && days.length > 0 && (
        <PhotoViewer days={days} weights={weights} start={view.start} compare={view.compare} onClose={() => setView(null)}
          onEdit={(d) => setEdit({ day: d.day })} />
      )}
    </>
  );
}

/** Weight page card: the latest front photo, how many check-ins, and a way in. */
export function PhotosCard({ onOpen, onAdd }: { onOpen: () => void; onAdd: () => void }) {
  const { photos } = usePhotos();
  const days = useMemo(() => byDay(photos ?? []), [photos]);
  const latest = days[0];
  const ph = latest ? latest.photos.front ?? latest.photos.side ?? latest.photos.back : null;
  const u = useSignedUrls(ph ? [ph.thumb_path] : []);
  const ago = latest ? Math.round((fromYmd(todayYmd()).getTime() - fromYmd(latest.day).getTime()) / 86400000) : null;
  return (
    <section className="panel pp-card">
      <button className="pp-card-main" onClick={latest ? onOpen : onAdd}>
        <span className="pp-card-img">{ph && u.get(ph.thumb_path) ? <img src={u.get(ph.thumb_path)} alt="" /> : <PoseIcon pose="front" />}</span>
        <span className="pp-card-text">
          <strong>Progress photos</strong>
          <span className="small muted">
            {latest ? `${days.length} check-in${days.length === 1 ? "" : "s"} · last ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}` : "Front, side and back, to compare week by week"}
          </span>
        </span>
        <span aria-hidden="true" className="muted">›</span>
      </button>
      <button className="btn ghost pp-card-add" onClick={onAdd}>+ Add</button>
    </section>
  );
}
