import { useState } from "react";
import type { AppData } from "../../App";
import type { Template } from "../../lib/strength";
import type { Program } from "../../lib/programs";
import { liveSteps } from "../../lib/programs";
import { formatShort } from "../../lib/dates";
import CoachPanel from "../CoachPanel";
import ProgramsSection from "../ProgramsSection";
import TemplateEditor from "../TemplateEditor";
import ProgramEditor from "../ProgramEditor";

type Sel = { k: "overview" } | { k: "template"; id: string | null } | { k: "program"; id: string | null };

/** Laptop: programs and templates listed on the left; the selected one opens for editing on the right. */
export default function DeskTrain({ data, onChanged, onOpenExercise, onPlan }: {
  data: AppData; onChanged: () => Promise<void> | void; onOpenExercise: (id: string) => void; onPlan: () => void;
}) {
  const { templates, programs, workouts } = data;
  const [sel, setSel] = useState<Sel>({ k: "overview" });
  const lastDone = (t: Template) => workouts.find((w) => w.template_id === t.id)?.started_at;
  const is = (k: Sel["k"], id?: string | null) => sel.k === k && (k === "overview" || (sel as { id: string | null }).id === id);
  const saved = async () => { await onChanged(); };
  const selTemplate = sel.k === "template" && sel.id ? templates.find((t) => t.id === sel.id) ?? null : null;
  const selProgram: Program | null = sel.k === "program" && sel.id ? programs.find((p) => p.id === sel.id) ?? null : null;

  return (
    <div className="split">
      <aside className="split-list" aria-label="Programs and templates">
        <div className="panel list-panel">
          <button className={`list-row${is("overview") ? " sel" : ""}`} onClick={() => setSel({ k: "overview" })}>
            <span><strong>Overview</strong><span className="small muted" style={{ display: "block" }}>Active program and coach</span></span>
          </button>
          <button className="list-row" onClick={onPlan}>
            <span><strong>Plan my week</strong><span className="small muted" style={{ display: "block" }}>Open the week board</span></span>
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className="split-group">
          <h2 className="group-h">Programs</h2>
          <button className="link small" onClick={() => setSel({ k: "program", id: null })}>+ New</button>
        </div>
        <div className="panel list-panel">
          {programs.length === 0 && <p className="small muted" style={{ padding: "10px 12px", margin: 0 }}>No programs yet.</p>}
          {programs.map((p) => (
            <button key={p.id} className={`list-row${is("program", p.id) ? " sel" : ""}`} onClick={() => setSel({ k: "program", id: p.id })}>
              <span style={{ minWidth: 0 }}>
                <strong>{p.name}</strong>{p.id === data.activeProgramId && <span className="chip prog-active" style={{ marginLeft: 6 }}>Active</span>}
                <span className="small muted split-sub">{liveSteps(p, templates).map((s) => s.template.name).join(" → ") || "No workouts"}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="split-group">
          <h2 className="group-h">Templates</h2>
          <button className="link small" onClick={() => setSel({ k: "template", id: null })}>+ New</button>
        </div>
        <div className="panel list-panel">
          {templates.length === 0 && <p className="small muted" style={{ padding: "10px 12px", margin: 0 }}>No templates yet.</p>}
          {templates.map((t) => {
            const last = lastDone(t);
            return (
              <button key={t.id} className={`list-row${is("template", t.id) ? " sel" : ""}`} onClick={() => setSel({ k: "template", id: t.id })}>
                <span style={{ minWidth: 0 }}>
                  <strong>{t.name}</strong>
                  <span className="small muted split-sub">{t.exercises.length} exercise{t.exercises.length === 1 ? "" : "s"}{t.kind === "conditioning" ? " · conditioning" : ""} · {last ? `last ${formatShort(new Date(last))}` : "not done yet"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="split-detail">
        {sel.k === "overview" && (
          <div className="detail-cols">
            <div>
              <ProgramsSection data={data} busyDraft={false} onStart={() => undefined} onEdit={(p) => setSel({ k: "program", id: p?.id ?? null })} onChanged={() => void onChanged()} />
            </div>
            <div>
              <CoachPanel data={data} onOpenExercise={onOpenExercise} onChanged={() => void onChanged()} />
            </div>
          </div>
        )}
        {sel.k === "template" && (sel.id === null || selTemplate) && (
          <div className="panel detail-panel">
            <TemplateEditor key={sel.id ?? "new"} template={selTemplate} data={data}
              onClose={() => setSel({ k: "overview" })}
              onSaved={async () => { await saved(); if (sel.id === null) setSel({ k: "overview" }); }}
              onCreatedExercise={() => void onChanged()} />
          </div>
        )}
        {sel.k === "program" && (sel.id === null || selProgram) && (
          <div className="panel detail-panel">
            <ProgramEditor key={sel.id ?? "new"} program={selProgram} data={data}
              onClose={() => setSel({ k: "overview" })}
              onSaved={async () => { await saved(); if (sel.id === null) setSel({ k: "overview" }); }} />
          </div>
        )}
        {((sel.k === "template" && sel.id && !selTemplate) || (sel.k === "program" && sel.id && !selProgram)) && (
          <div className="panel split-empty"><p>That was deleted. Pick something from the list.</p></div>
        )}
      </div>
    </div>
  );
}
