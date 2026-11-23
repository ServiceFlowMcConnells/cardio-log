import { EVIDENCE_LABEL, SUPPLEMENT_STACK, currentSlot } from "../lib/supplements";

/** Read-only reference: the daily supplement stack by time of day, with dose, benefit and evidence. */
export default function Supplements({ onBack }: { onBack: () => void }) {
  const now = currentSlot();
  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Supplements</h1>
          <p className="muted small">Daily stack, by time of day</p>
        </div>
        <button className="btn ghost" onClick={onBack}>Done</button>
      </div>
      <p className="supp-legend small muted">
        Evidence: <span className="chip ev-strong">Strong</span> <span className="chip ev-moderate">Moderate</span> <span className="chip ev-limited">Limited</span>
      </p>
      {SUPPLEMENT_STACK.map((slot) => (
        <section key={slot.id} className={`panel supp-slot${slot.id === now ? " now" : ""}`} aria-label={slot.title}>
          <div className="supp-head">
            <h2>{slot.title}</h2>
            {slot.id === now && <span className="chip supp-now">Now</span>}
          </div>
          {slot.when && <p className="small muted supp-when">{slot.when}</p>}
          <ul className="supp-list">
            {slot.items.map((s, i) => (
              <li key={i}>
                <div className="supp-row">
                  <span className="supp-name">{s.name} <span className="muted supp-dose">· {s.dose}</span></span>
                  {s.evidence && <span className={`chip ev-${s.evidence}`}>{EVIDENCE_LABEL[s.evidence]}</span>}
                </div>
                {s.benefit && <p className="small supp-benefit">{s.benefit}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="small muted supp-foot">Bloods before and after the Tongkat Ali course: testosterone, ferritin, iron and vitamin D.</p>
    </>
  );
}
