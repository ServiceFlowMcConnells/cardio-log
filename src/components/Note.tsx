import { useState, type ReactNode } from "react";

/** A chart's explanation: one line, with the rest behind "Why?" (progressive disclosure). */
export default function Note({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`note${open ? " open" : ""}`} style={style}>
      <p className="chart-note note-text">{children}</p>
      <button type="button" className="note-why" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Less" : "Why?"}</button>
    </div>
  );
}
