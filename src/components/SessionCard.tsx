import type { Session, Settings } from "../lib/types";
import { MACHINE_LABEL } from "../lib/types";
import { formatDay, formatTime } from "../lib/dates";
import { sessionMinutes, settingsSummary, zoneFor, zoneStatus } from "../lib/calc";

const ZONE_TEXT = { in: "in zone", over: "above zone", under: "below zone" } as const;

export default function SessionCard({ session, settings, onOpen }: { session: Session; settings: Settings; onOpen: (s: Session) => void }) {
  const d = new Date(session.performed_at);
  const z = zoneFor(settings);
  return (
    <button className="session-card" onClick={() => onOpen(session)}>
      <div className="top">
        <span className="when">
          {formatDay(d)} <span className="muted small">{formatTime(d)}</span>
        </span>
        <span className="mins">{Math.round(sessionMinutes(session))} min</span>
      </div>
      {session.blocks.map((b, i) => {
        const zs = zoneStatus(b.avg_hr, z);
        const summary = settingsSummary(b);
        return (
          <div className="block-line" key={b.id ?? i}>
            <span>
              <span className={`dot ${b.machine}`} aria-hidden="true" style={{ marginRight: 8 }} />
              {MACHINE_LABEL[b.machine]} {Math.round(b.duration_min)} min{summary ? `, ${summary}` : ""}
            </span>
            {b.avg_hr != null && <span className={`chip ${zs ?? ""}`}>{b.avg_hr} bpm{zs ? ` ${ZONE_TEXT[zs]}` : ""}</span>}
            {b.rpe != null && <span className="chip">RPE {b.rpe}</span>}
            {b.is_benchmark && <span className="chip bench">Benchmark</span>}
          </div>
        );
      })}
      {session.notes && <p className="muted small" style={{ marginTop: 6 }}>{session.notes}</p>}
    </button>
  );
}
