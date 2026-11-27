import { useState } from "react";
import type { SlotId, SupplementItem } from "../lib/supplements";
import { EVIDENCE_LABEL, SLOTS, activeItems, currentSlot, moveSupplementItem, retireSupplementItem, saveSupplementItem, useSupplementItems } from "../lib/supplements";

/** Your daily stack by time of day. Edit mode adds, changes, reorders and removes items; removed items are
 *  retired, not deleted, so past evening check-ins keep them. */
export default function Supplements({ onBack }: { onBack: () => void }) {
  const now = currentSlot();
  const all = useSupplementItems();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<null | { id?: string; slot: SlotId }>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = all ? activeItems(all) : [];
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save that."); }
    setBusy(false);
  };

  return (
    <>
      <div className="editor-bar">
        <div>
          <h1>Supplements</h1>
          <p className="muted small">Daily stack, by time of day</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost" onClick={() => { setEditing((e) => !e); setForm(null); setConfirm(null); }}>{editing ? "Finish editing" : "Edit"}</button>
          {!editing && <button className="btn ghost" onClick={onBack}>Done</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {editing ? (
        <p className="small muted supp-legend">Removing an item takes it off your list and future check-ins. Past check-ins keep it as it was.</p>
      ) : (
        <p className="supp-legend small muted">
          Evidence: <span className="chip ev-strong">Strong</span> <span className="chip ev-moderate">Moderate</span> <span className="chip ev-limited">Limited</span>
        </p>
      )}
      {all == null && <p className="muted small">Loading…</p>}
      {all != null && SLOTS.map((slot) => {
        const list = items.filter((i) => i.slot === slot.id);
        if (!editing && !list.length) return null;
        return (
          <section key={slot.id} className={`panel supp-slot${slot.id === now && !editing ? " now" : ""}`} aria-label={slot.title}>
            <div className="supp-head">
              <h2>{slot.title}</h2>
              {slot.id === now && !editing && <span className="chip supp-now">Now</span>}
            </div>
            {slot.when && <p className="small muted supp-when">{slot.when}</p>}
            <ul className="supp-list">
              {list.map((s, i) => (
                <li key={s.id}>
                  {form?.id === s.id ? (
                    <ItemForm item={s} slot={s.slot} busy={busy} onCancel={() => setForm(null)} onSave={(v) => run(async () => { await saveSupplementItem({ ...v, id: s.id }); setForm(null); })} />
                  ) : (
                    <>
                      <div className="supp-row">
                        <span className="supp-name">{s.name}{s.dose && <span className="muted supp-dose"> · {s.dose}</span>}</span>
                        {!editing && s.evidence && <span className={`chip ev-${s.evidence}`}>{EVIDENCE_LABEL[s.evidence]}</span>}
                        {editing && (
                          <span className="supp-tools">
                            <button className="icon-btn" aria-label={`Move ${s.name} up`} disabled={busy || i === 0} onClick={() => run(() => moveSupplementItem(all, s.id, -1))}>↑</button>
                            <button className="icon-btn" aria-label={`Move ${s.name} down`} disabled={busy || i === list.length - 1} onClick={() => run(() => moveSupplementItem(all, s.id, 1))}>↓</button>
                            <button className="link small" onClick={() => { setForm({ id: s.id, slot: s.slot }); setConfirm(null); }}>Edit</button>
                            <button className={`link small${confirm === s.id ? " danger" : ""}`} disabled={busy} onClick={() => (confirm === s.id ? run(async () => { await retireSupplementItem(s.id); setConfirm(null); }) : setConfirm(s.id))}>{confirm === s.id ? "Remove?" : "Remove"}</button>
                          </span>
                        )}
                      </div>
                      {!editing && s.benefit && <p className="small supp-benefit">{s.benefit}</p>}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {editing && (form && !form.id && form.slot === slot.id ? (
              <ItemForm slot={slot.id as SlotId} busy={busy} onCancel={() => setForm(null)} onSave={(v) => run(async () => { await saveSupplementItem({ ...v, position: list.length }); setForm(null); })} />
            ) : (
              <button className="link small" onClick={() => { setForm({ slot: slot.id as SlotId }); setConfirm(null); }}>+ Add to {slot.title.toLowerCase()}</button>
            ))}
          </section>
        );
      })}
      {!editing && <p className="small muted supp-foot">Bloods before and after the Tongkat Ali course: testosterone, ferritin, iron and vitamin D.</p>}
    </>
  );
}

function ItemForm({ item, slot: slot0, busy, onSave, onCancel }: { item?: SupplementItem; slot: SlotId; busy: boolean; onSave: (v: { slot: SlotId; name: string; dose: string; benefit: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [dose, setDose] = useState(item?.dose ?? "");
  const [slot, setSlot] = useState<SlotId>(item?.slot ?? slot0);
  const [benefit, setBenefit] = useState(item?.benefit ?? "");
  return (
    <form className="supp-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave({ slot, name, dose, benefit: benefit.trim() || null }); }}>
      <label className="field"><span>Name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Magnesium glycinate" autoFocus /></label>
      <label className="field"><span>Dose</span><input className="input" value={dose} maxLength={120} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 200 mg" /></label>
      <label className="field"><span>Time of day</span>
        <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as SlotId)}>{SLOTS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
      </label>
      <label className="field"><span>What it's for (optional)</span><input className="input" value={benefit} maxLength={400} onChange={(e) => setBenefit(e.target.value)} /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{item ? "Save" : "Add"}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
