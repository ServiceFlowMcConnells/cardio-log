// Supplements: the times of day, your own list (supplement_items, editable on the Supplements page), and the
// original stack it was seeded from.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Evidence = "strong" | "moderate" | "limited";

export interface Supplement {
  name: string;
  dose: string;
  benefit?: string;
  evidence?: Evidence;
}

export interface SupplementSlot {
  id: string;
  title: string;
  when?: string;
  items: Supplement[];
}

export const SUPPLEMENT_STACK: SupplementSlot[] = [
  {
    id: "waking",
    title: "On waking",
    when: "Empty stomach, 30 min before food",
    items: [
      { name: "NAC", dose: "500 mg", benefit: "Antioxidant (glutathione) support for liver and lungs. Keep it a few hours away from training.", evidence: "limited" },
    ],
  },
  {
    id: "breakfast",
    title: "Breakfast",
    when: "With a meal containing some fat",
    items: [
      { name: "Multivitamin", dose: "1 capsule (1 of 3)", benefit: "Fills dietary gaps. The 3 daily capsules include 2,000 IU D3 and 8.25 mg zinc.", evidence: "moderate" },
      { name: "Tongkat Ali (DNA Sports)", dose: "1 capsule · 300 mg · 90-day course", benefit: "Testosterone, libido and energy support. Mornings only, as some find it stimulating.", evidence: "limited" },
      { name: "Creatine", dose: "5 g", benefit: "Strength, power, lean mass and recovery. Daily consistency matters more than timing.", evidence: "strong" },
      { name: "Vitamin D3", dose: "2,000 IU", benefit: "Bones, immunity, muscle function and mood. With the multi, 4,000 IU a day in total.", evidence: "strong" },
      { name: "Omega-3", dose: "Per label", benefit: "Heart, joints and inflammation; may help mood. With food to avoid fishy burps.", evidence: "moderate" },
      { name: "L-Theanine", dose: "200 mg", benefit: "Calm focus without drowsiness; smooths out caffeine.", evidence: "moderate" },
    ],
  },
  {
    id: "lunch",
    title: "Lunch",
    when: "With food",
    items: [{ name: "Multivitamin", dose: "1 capsule (2 of 3)" }],
  },
  {
    id: "dinner",
    title: "Dinner",
    when: "With food",
    items: [{ name: "Multivitamin", dose: "1 capsule (3 of 3)" }],
  },
  {
    id: "bed",
    title: "About 1 hour before bed",
    items: [
      { name: "PER4M Zinc & Magnesium", dose: "2 capsules · 30–60 min before bed", benefit: "300 mg magnesium (bisglycinate, citrate, oxide), about 9 mg zinc and B6. Sleep quality, muscle relaxation, recovery and immunity.", evidence: "moderate" },
      { name: "Ashwagandha (KSM-66)", dose: "600 mg", benefit: "Lowers stress and cortisol; aids sleep, with modest strength and recovery gains.", evidence: "moderate" },
    ],
  },
];

/** The times of day, in order (the items in each now come from your own list). */
export const SLOTS = SUPPLEMENT_STACK.map(({ id, title, when }) => ({ id, title, when }));
export type SlotId = "waking" | "breakfast" | "lunch" | "dinner" | "bed";

export const EVIDENCE_LABEL: Record<Evidence, string> = { strong: "Strong", moderate: "Moderate", limited: "Limited" };

/** The slot to highlight for the time of day, so the page opens on what's next. */
export function currentSlot(now = new Date()): string {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 8) return "waking";
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 20) return "dinner";
  return "bed";
}

// ---------- Your own list (supplement_items) ----------

export interface SupplementItem { id: string; slot: SlotId; name: string; dose: string; benefit: string | null; evidence: Evidence | null; position: number; retired_at: string | null }

let cache: SupplementItem[] | null = null;
let loading: Promise<SupplementItem[]> | null = null;
const subs = new Set<(s: SupplementItem[]) => void>();
const emit = () => subs.forEach((f) => f(cache ?? []));
const SLOT_ORDER: SlotId[] = ["waking", "breakfast", "lunch", "dinner", "bed"];
const order = (a: SupplementItem, b: SupplementItem) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.position - b.position || a.name.localeCompare(b.name);

/** Every item, retired ones included (history needs their names). */
export async function loadSupplementItems(force = false): Promise<SupplementItem[]> {
  if (cache && !force) return cache;
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from("supplement_items").select("id, slot, name, dose, benefit, evidence, position, retired_at");
    if (error) throw error;
    cache = ((data ?? []) as SupplementItem[]).sort(order);
    emit();
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}
export function useSupplementItems(): SupplementItem[] | null {
  const [s, setS] = useState<SupplementItem[] | null>(cache);
  useEffect(() => {
    subs.add(setS);
    loadSupplementItems().catch(() => setS((x) => x ?? []));
    return () => { subs.delete(setS); };
  }, []);
  return s;
}
/** Your current list: what's not retired. */
export const activeItems = (items: SupplementItem[]) => items.filter((i) => !i.retired_at);

export async function saveSupplementItem(i: { id?: string; slot: SlotId; name: string; dose: string; benefit: string | null; evidence?: Evidence | null; position?: number }) {
  const row = { slot: i.slot, name: i.name.trim(), dose: i.dose.trim(), benefit: i.benefit?.trim() || null, ...(i.evidence !== undefined ? { evidence: i.evidence } : {}), ...(i.position !== undefined ? { position: i.position } : {}) };
  const q = i.id ? supabase.from("supplement_items").update(row).eq("id", i.id) : supabase.from("supplement_items").insert(row);
  const { error } = await q;
  if (error) throw error;
  await loadSupplementItems(true);
}
/** Retire, never delete: past check-ins keep showing it. */
export async function retireSupplementItem(id: string) {
  const { error } = await supabase.from("supplement_items").update({ retired_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  await loadSupplementItems(true);
}
/** Swap an item with its neighbour in the same time of day. */
export async function moveSupplementItem(items: SupplementItem[], id: string, dir: -1 | 1) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const same = activeItems(items).filter((x) => x.slot === it.slot);
  const i = same.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= same.length) return;
  const re = [...same];
  [re[i], re[j]] = [re[j], re[i]];
  const updates = re.map((x, k) => supabase.from("supplement_items").update({ position: k }).eq("id", x.id));
  const res = await Promise.all(updates);
  const bad = res.find((r) => r.error);
  if (bad?.error) throw bad.error;
  await loadSupplementItems(true);
}
