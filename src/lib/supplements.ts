/** The daily supplement stack: a fixed reference, not logged. Edit this list to change what the Supplements page shows. */

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
