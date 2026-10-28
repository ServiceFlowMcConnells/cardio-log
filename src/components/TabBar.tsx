export type Tab = "week" | "history" | "log" | "progress" | "settings";

const icons: Record<Exclude<Tab, "log">, JSX.Element> = {
  week: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="13" width="18" height="6" rx="1.5" />
      <path d="M3 9h11" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  progress: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
};

const labels: Record<Tab, string> = { week: "Week", history: "History", log: "Log", progress: "Progress", settings: "Settings" };

export default function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const order: Tab[] = ["week", "history", "log", "progress", "settings"];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {order.map((t) =>
          t === "log" ? (
            <button key={t} className="tab log" onClick={() => onTab(t)} aria-label="Log session">
              <span className="plus">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </button>
          ) : (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => onTab(t)} aria-current={tab === t ? "page" : undefined}>
              {icons[t]}
              {labels[t]}
            </button>
          )
        )}
      </div>
    </nav>
  );
}
