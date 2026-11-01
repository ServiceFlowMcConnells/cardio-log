import { useEffect, useRef, useState } from "react";

export interface Shortcut {
  key: string;
  label: string;
  sub?: string;
  icon: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
}

const sv = (d: JSX.Element) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const ShortcutIcons = {
  workout: sv(<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />),
  cardio: sv(<path d="M3 12h4l2.5-6 4 12 2.5-6H21" />),
  readiness: sv(<><path d="M4.5 16a8 8 0 1 1 15 0" /><path d="M12 16l3.5-5" /><circle cx="12" cy="16" r="1.2" fill="currentColor" /></>),
  mobility: sv(<><circle cx="12" cy="4.5" r="1.8" /><path d="M5 9l7 1.5L19 9M12 10.5V15l-3.5 5.5M12 15l3.5 5.5" /></>),
  food: sv(<><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10" /><path d="M17 21V3c-2.2 1.2-3.5 3.7-3.5 7v3H17" /></>),
  barcode: sv(<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16.5 8v8" />),
  quick: sv(<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z" />),
  weight: sv(<><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8.5 9.5a5 5 0 0 1 7 0L13 12" /></>),
  programs: sv(<path d="M4 6h16M4 12h16M4 18h10" />),
  plan: sv(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  trends: sv(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  library: sv(<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5.5l3.8-1 3.7 14.5-3.8 1z" />),
};

/** Slides up from the tab bar: quick-launch buttons for the things you do most, then shortcuts to pages. */
export default function ShortcutSheet({ open, onClose, quick, links }: { open: boolean; onClose: () => void; quick: { title: string; items: Shortcut[] }[]; links: Shortcut[] }) {
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { if (!open) setDy(0); }, [open]);
  const run = (s: Shortcut) => { onClose(); s.onClick(); };
  return (
    <>
      <div className={`sheet-backdrop${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <div
        className={`sheet${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Shortcuts"
        aria-hidden={!open}
        style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
      >
        {/* Drag the top of the sheet down to close it */}
        <div
          className="sheet-grab"
          onPointerDown={(e) => { drag.current = { y: e.clientY }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)); }}
          onPointerUp={() => { const d = dy; drag.current = null; setDy(0); if (d > 70) onClose(); }}
          onPointerCancel={() => { drag.current = null; setDy(0); }}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <div className="sheet-head">
            <button className="icon-btn sheet-x" aria-label="Close shortcuts" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <strong>Shortcuts</strong>
            <span style={{ width: 40 }} />
          </div>
        </div>
        <div className="sheet-body">
          {quick.map((g) => (
            <div key={g.title} className="sc-group">
              <span className="sc-group-title">{g.title}</span>
              <div className="sc-grid">
                {g.items.map((s) => (
                  <button key={s.key} className="sc-btn" onClick={() => run(s)} disabled={s.disabled} tabIndex={open ? 0 : -1}>
                    <span className="sc-icon">{s.icon}</span>
                    <span className="sc-label">{s.label}</span>
                    {s.sub && <span className="sc-sub">{s.sub}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="sc-links">
            {links.map((s) => (
              <button key={s.key} className="sc-link" onClick={() => run(s)} tabIndex={open ? 0 : -1}>
                <span className="sc-link-icon">{s.icon}</span>
                <span className="sc-link-label">{s.label}{s.sub && <span className="small muted" style={{ display: "block" }}>{s.sub}</span>}</span>
                <span aria-hidden="true" className="sc-chev">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
