import type { Tab } from "./TabBar";

export type DeskNav = Tab | "plan" | "mobility" | "settings";

const ITEMS: { id: DeskNav; label: string; icon: JSX.Element }[] = [
  { id: "week", label: "This week", icon: <path d="M3 13h18v6H3zM3 9h11" /> },
  { id: "food", label: "Food", icon: <><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10" /><path d="M17 21V3c-2.2 1.2-3.5 3.7-3.5 7v3H17" /></> },
  { id: "plan", label: "Plan my week", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
  { id: "train", label: "Programs & templates", icon: <path d="M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3" /> },
  { id: "exercises", label: "Exercises", icon: <path d="M7 7v10M17 7v10M4 9.5v5M20 9.5v5M7 12h10" /> },
  { id: "history", label: "History", icon: <path d="M4 6h16M4 12h16M4 18h10" /> },
  { id: "progress", label: "Progress", icon: <><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></> },
  { id: "mobility", label: "Mobility", icon: <><circle cx="12" cy="5" r="2" /><path d="M12 7v6l-4 7M12 13l4 7M6 10l6-1 6 1" /></> },
  { id: "settings", label: "Settings", icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></> },
];

export default function Sidebar({ active, onNav, onLogCardio, onLogFood, email }: { active: DeskNav; onNav: (n: DeskNav) => void; onLogCardio: () => void; onLogFood: () => void; email: string }) {
  return (
    <aside className="sidebar" aria-label="Main">
      <div className="side-brand">
        <img src="/icon.svg" alt="" width="32" height="32" />
        <span>Training Log</span>
      </div>
      <div className="side-ctas">
        <button className="btn primary side-cta" onClick={onLogFood}>+ Log food</button>
        <button className="btn ghost side-cta" onClick={onLogCardio}>+ Log cardio</button>
      </div>
      <nav className="side-nav">
        {ITEMS.map((it) => (
          <button key={it.id} className={`side-item${active === it.id ? " active" : ""}`} aria-current={active === it.id ? "page" : undefined} onClick={() => onNav(it.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{it.icon}</svg>
            {it.label}
          </button>
        ))}
      </nav>
      <p className="side-foot small muted">
        Desktop view for planning and editing. Record strength workouts on your phone.
        <span style={{ display: "block", marginTop: 6 }}>{email}</span>
      </p>
    </aside>
  );
}
