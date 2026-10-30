// Branded food search via Open Food Facts (Irish products first, then UK). Signed-in users only (verify_jwt).
// POST { q } for a text search, or { code } for a barcode. Returns per-100 g values.
const UA = "TrainingLog/1.0 (personal training app)";
const FIELDS = "code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,quantity,product_quantity";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type P = Record<string, unknown>;
const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : null; };
const r1 = (n: number) => Math.round(n * 10) / 10;

function toFood(p: P) {
  const nu = (p.nutriments ?? {}) as P;
  let kcal = num(nu["energy-kcal_100g"]);
  if (kcal == null) { const kj = num(nu["energy-kj_100g"]) ?? num(nu["energy_100g"]); if (kj != null) kcal = kj / 4.184; }
  const name = String(p.product_name ?? "").trim();
  if (kcal == null || !name || !p.code) return null;
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands ?? "").split(",");
  const brand = String(brands[0] ?? "").trim() || null;
  let sq = num(p.serving_quantity);
  const unit = String(p.serving_quantity_unit ?? "g").toLowerCase();
  let label = sq && sq > 0 && p.serving_size ? String(p.serving_size).slice(0, 40) : null;
  if (!(sq && sq > 0)) {
    // No serving on the label data: try the pack size, e.g. "6 x 62 g" or "8 wraps" in a 496 g pack
    const q = String(p.quantity ?? "");
    const multi = q.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
    const count = q.match(/^\s*(\d+)\s+([a-z]+)/i);
    const pq = num(p.product_quantity);
    if (multi) { sq = parseFloat(multi[2].replace(",", ".")); label = `1 (${sq} ${multi[3].toLowerCase()})`; }
    else if (count && pq && +count[1] > 1 && +count[1] <= 48 && !/^(g|kg|ml|l|cl|oz)$/i.test(count[2])) {
      sq = Math.round((pq / +count[1]) * 10) / 10;
      label = `1 ${count[2].toLowerCase().replace(/ies$/, "y").replace(/s$/, "")}`;
    }
  }
  return {
    ref: String(p.code), name, brand, barcode: String(p.code),
    kcal: Math.round(kcal), protein: r1(num(nu.proteins_100g) ?? 0), carbs: r1(num(nu.carbohydrates_100g) ?? 0), fat: r1(num(nu.fat_100g) ?? 0),
    fibre: num(nu.fiber_100g) == null ? null : r1(num(nu.fiber_100g)!),
    serving_g: sq && sq > 0 && (unit === "g" || unit === "ml") ? sq : null,
    serving_label: sq && sq > 0 && (unit === "g" || unit === "ml") ? label : null,
  };
}

async function search(q: string, country: string, size: number): Promise<P[]> {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(`${q} countries_tags:"en:${country}"`)}&page_size=${size}&langs=en&fields=${FIELDS}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`search ${r.status}`);
  return ((await r.json()).hits ?? []) as P[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { q, code } = await req.json().catch(() => ({}));
    if (code && /^\d{6,14}$/.test(String(code))) {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${FIELDS}`, { headers: { "User-Agent": UA } });
      const j = r.ok ? await r.json() : null;
      const f = j?.product ? toFood({ ...j.product, code }) : null;
      return Response.json({ results: f ? [f] : [] }, { headers: cors });
    }
    const term = String(q ?? "").trim().slice(0, 80).replace(/["\\:]/g, " ");
    if (term.length < 2) return Response.json({ results: [] }, { headers: cors });
    const [ie, uk] = await Promise.allSettled([search(term, "ireland", 25), search(term, "united-kingdom", 15)]);
    if (ie.status === "rejected" && uk.status === "rejected") throw ie.reason;
    const seen = new Set<string>();
    const results = [];
    for (const p of [...(ie.status === "fulfilled" ? ie.value : []), ...(uk.status === "fulfilled" ? uk.value : [])]) {
      const f = toFood(p);
      if (!f || seen.has(f.ref)) continue;
      seen.add(f.ref);
      results.push(f);
    }
    return Response.json({ results }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502, headers: cors });
  }
});
