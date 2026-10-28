export type Tab = "week" | "history" | "train" | "exercises" | "progress";

const icons: Record<Exclude<Tab, "train">, JSX.Element> = {
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
  exercises: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 7v10M17 7v10M4 9.5v5M20 9.5v5M7 12h10" />
    </svg>
  ),
};

const labels: Record<Tab, string> = { week: "Week", history: "History", train: "Train", exercises: "Exercises", progress: "Progress" };

export default function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const order: Tab[] = ["week", "history", "train", "exercises", "progress"];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {order.map((t) =>
          t === "train" ? (
            <button key={t} className={`tab log${tab === t ? " active" : ""}`} onClick={() => onTab(t)} aria-label="Train: log cardio or start a workout" aria-current={tab === t ? "page" : undefined}>
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
