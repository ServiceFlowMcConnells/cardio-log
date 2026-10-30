import { useEffect, useMemo, useState } from "react";
import type { DbFood, Food, NutritionData, Recipe } from "../../lib/nutrition";
import { foodByBarcode, loadFoodDb, lookupBarcode, matchScore, perServing, searchBranded } from "../../lib/nutrition";
import BarcodeScanner from "./BarcodeScanner";

export type Picked = { type: "food"; food: Food } | { type: "db"; db: DbFood } | { type: "recipe"; recipe: Recipe };

const per100 = (m: { kcal: number; protein: number }) => `${Math.round(m.kcal)} kcal · ${Math.round(m.protein * 10) / 10} g protein per 100 g`;

/** Search box over your foods (and recipes), the McCance & Widdowson reference foods, and Open Food Facts. */
export default function FoodSearch({ nutri, onPick, recipes = true, query, setQuery, autoFocus, onNewFood }: {
  nutri: NutritionData;
  onPick: (p: Picked) => void;
  recipes?: boolean;
  query: string;
  setQuery: (q: string) => void;
  autoFocus?: boolean;
  onNewFood?: (name: string, barcode?: string) => void; // offered when a scanned barcode isn't found
}) {
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<null | { code: string; busy?: boolean; missing?: boolean; error?: string }>(null);
  const canScan = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  async function onCode(code: string) {
    setScanning(false);
    const mine = foodByBarcode(nutri.foods, code);
    if (mine) { setScan(null); onPick({ type: "food", food: mine }); return; }
    setScan({ code, busy: true });
    try {
      const found = await lookupBarcode(code);
      if (found) { setScan(null); onPick({ type: "db", db: found }); }
      else setScan({ code, missing: true });
    } catch (e) {
      setScan({ code, error: e instanceof Error ? e.message : "Lookup failed." });
    }
  }
  const [db, setDb] = useState<DbFood[] | null>(null);
  const [dbErr, setDbErr] = useState(false);
  const [branded, setBranded] = useState<{ q: string; results: DbFood[] } | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandErr, setBrandErr] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2 || db) return;
    loadFoodDb().then(setDb).catch(() => setDbErr(true));
  }, [q, db]);

  const mine = useMemo(() => {
    if (q.length < 1) return [];
    const bonus = (s: number, extra: number) => (s < 0 ? -1 : s + extra);
    const fs = nutri.foods.filter((f) => !f.archived).map((f) => ({ p: { type: "food", food: f } as Picked, s: bonus(matchScore(`${f.name} ${f.brand ?? ""}`, q), f.favorite ? 1 : 0) }));
    const rs = recipes ? nutri.recipes.map((r) => ({ p: { type: "recipe", recipe: r } as Picked, s: bonus(matchScore(r.name, q), 1) })) : [];
    return [...fs, ...rs].filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.p);
  }, [nutri, q, recipes]);

  const generic = useMemo(() => {
    if (!db || q.length < 2) return [];
    const have = new Set(nutri.foods.filter((f) => f.source === "cofid").map((f) => f.source_ref));
    return db.map((d) => ({ d, s: matchScore(d.name, q) })).filter((x) => x.s >= 0 && !have.has(x.d.ref)).sort((a, b) => b.s - a.s).slice(0, 25).map((x) => x.d);
  }, [db, q, nutri.foods]);

  async function findBranded() {
    if (q.length < 2) return;
    setBrandBusy(true);
    setBrandErr(null);
    try {
      setBranded({ q, results: await searchBranded(q) });
    } catch (e) {
      setBrandErr(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBrandBusy(false);
    }
  }

  const showBranded = branded && branded.q === q;
  const have = new Set(nutri.foods.filter((f) => f.source === "off").map((f) => f.source_ref));

  return (
    <>
      {scanning && <BarcodeScanner onCode={onCode} onClose={() => setScanning(false)} />}
      <form className="food-search" role="search" onSubmit={(e) => { e.preventDefault(); findBranded(); }}>
        <input
          className="input"
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search foods, e.g. porridge oats, Brennans"
          aria-label="Search foods"
          enterKeyHint="search"
        />
        {canScan && (
          <button type="button" className="scan-btn" aria-label="Scan a barcode" onClick={() => { setScan(null); setScanning(true); }}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8" /></svg>
          </button>
        )}
      </form>
      {scan && (
        <div className={`panel scan-result${scan.missing || scan.error ? " warn" : ""}`}>
          {scan.busy ? <p className="small">Looking up {scan.code}…</p>
            : scan.error ? <p className="small error">{scan.error}</p>
            : (
              <>
                <p className="small"><strong>{scan.code}</strong> isn't in Open Food Facts yet.</p>
                {onNewFood && <button className="btn block" style={{ marginTop: 8 }} onClick={() => onNewFood("", scan.code)}>Add it from the label</button>}
                <p className="muted small" style={{ marginTop: 6 }}>Saved with its barcode, so it comes straight up next time you scan it.</p>
              </>
            )}
          {!scan.busy && <button className="link small" style={{ marginTop: 6 }} onClick={() => setScan(null)}>Dismiss</button>}
        </div>
      )}

      {q.length > 0 && (
        <>
          {mine.length > 0 && (
            <>
              <h3 className="group-h">Your foods{recipes ? " and recipes" : ""}</h3>
              <div className="panel list-panel">
                {mine.map((p) => (
                  <button key={p.type + (p.type === "food" ? p.food.id : p.type === "recipe" ? p.recipe.id : "")} className="list-row" onClick={() => onPick(p)}>
                    {p.type === "food" ? (
                      <span><strong>{p.food.name}</strong>{p.food.brand && <span className="muted"> · {p.food.brand}</span>}<span className="small muted" style={{ display: "block" }}>{per100(p.food)}</span></span>
                    ) : p.type === "recipe" ? (
                      <span><strong>{p.recipe.name}</strong> <span className="chip">recipe</span><span className="small muted" style={{ display: "block" }}>{Math.round(perServing(p.recipe, nutri.foods).kcal)} kcal per serving</span></span>
                    ) : null}
                    <span className="muted" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {q.length >= 2 && (
            <>
              <h3 className="group-h">Basic foods <span className="small muted">McCance &amp; Widdowson</span></h3>
              {dbErr ? <p className="error">Couldn't load the food database. Check your connection.</p>
                : !db ? <p className="muted small">Loading…</p>
                : generic.length === 0 ? <p className="muted small">No basic foods match. Try fewer words, e.g. "oats" or "chicken".</p>
                : (
                  <div className="panel list-panel">
                    {generic.map((d) => (
                      <button key={d.ref} className="list-row" onClick={() => onPick({ type: "db", db: d })}>
                        <span>{d.name}<span className="small muted" style={{ display: "block" }}>{per100(d)}</span></span>
                        <span className="muted" aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                )}

              <h3 className="group-h">Branded foods <span className="small muted">Open Food Facts, Irish first</span></h3>
              {!showBranded ? (
                <button className="btn ghost block" disabled={brandBusy} onClick={findBranded}>{brandBusy ? "Searching…" : `Search branded foods for "${q}"`}</button>
              ) : branded!.results.length === 0 ? (
                <p className="muted small">Nothing found. Try the brand and product, e.g. "Avonmore milk", or add it as a new food from the label.</p>
              ) : (
                <div className="panel list-panel">
                  {branded!.results.map((d) => (
                    <button key={d.ref} className="list-row" onClick={() => onPick({ type: "db", db: d })}>
                      <span><strong>{d.name}</strong>{d.brand && <span className="muted"> · {d.brand}</span>}{have.has(d.ref) && <span className="chip" style={{ marginLeft: 6 }}>saved</span>}<span className="small muted" style={{ display: "block" }}>{per100(d)}</span></span>
                      <span className="muted" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              )}
              {brandErr && <p className="error">{brandErr}</p>}
              {showBranded && <p className="muted small" style={{ marginTop: 6 }}>Crowd-sourced data: check it against the label the first time you use it.</p>}
            </>
          )}
        </>
      )}
    </>
  );
}
