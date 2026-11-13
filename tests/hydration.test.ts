// Run: npm test   (node --test --experimental-strip-types; Node 22, no install needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyTotals, hitRate, litres, localDate, totalOn } from "../src/lib/waterMath.ts";

// A drink as the app logs it: local_date is fixed at logging time from the device's zone then
const log = (iso: string, ml: number, tz: string) => ({ logged_at: iso, ml, local_date: localDate(new Date(iso), tz) });

test("a minute either side of midnight lands on different days", () => {
  const a = log("2026-11-12T23:59:00Z", 250, "Europe/Dublin"); // GMT in November
  const b = log("2026-11-13T00:01:00Z", 500, "Europe/Dublin");
  assert.equal(a.local_date, "2026-11-12");
  assert.equal(b.local_date, "2026-11-13");
  const t = dailyTotals([a, b]);
  assert.equal(t.get("2026-11-12"), 250);
  assert.equal(t.get("2026-11-13"), 500);
});

test("summer time: 23:30 UTC is already the next day in Dublin", () => {
  assert.equal(localDate(new Date("2026-07-01T23:30:00Z"), "Europe/Dublin"), "2026-07-02");
  assert.equal(localDate(new Date("2026-07-01T22:59:00Z"), "Europe/Dublin"), "2026-07-01");
});

test("the night the clocks go back (25 Oct 2026) still splits at local midnight", () => {
  // 23:30 IST on 24 Oct = 22:30 UTC; 00:30 IST on 25 Oct = 23:30 UTC; 01:30 GMT (second time round) = 01:30 UTC
  const rows = [log("2026-10-24T22:30:00Z", 300, "Europe/Dublin"), log("2026-10-24T23:30:00Z", 200, "Europe/Dublin"), log("2026-10-25T01:30:00Z", 100, "Europe/Dublin")];
  assert.deepEqual(rows.map((r) => r.local_date), ["2026-10-24", "2026-10-25", "2026-10-25"]);
  assert.equal(totalOn(rows, "2026-10-25"), 300);
});

test("travelling: a drink keeps the day it was drunk, whatever zone you view it from", () => {
  // 22:00 in New York is 03:00 the next morning in Dublin
  const ny = log("2026-11-13T03:00:00Z", 330, "America/New_York");
  assert.equal(ny.local_date, "2026-11-12");
  const home = log("2026-11-13T09:00:00Z", 500, "Europe/Dublin");
  const t = dailyTotals([ny, home]);
  assert.equal(t.get("2026-11-12"), 330);
  assert.equal(t.get("2026-11-13"), 500);
  // "today" for someone now in Tokyo is a different calendar day to Dublin at the same instant
  assert.equal(localDate(new Date("2026-11-13T20:00:00Z"), "Asia/Tokyo"), "2026-11-14");
  assert.equal(localDate(new Date("2026-11-13T20:00:00Z"), "Europe/Dublin"), "2026-11-13");
});

test("totals, hit rate and litres formatting", () => {
  const rows = [
    { local_date: "2026-11-10", ml: 3000 }, { local_date: "2026-11-11", ml: 1500 }, { local_date: "2026-11-11", ml: 1500 },
    { local_date: "2026-11-12", ml: 2750 },
  ];
  const t = dailyTotals(rows);
  assert.equal(t.get("2026-11-11"), 3000);
  assert.deepEqual(hitRate(t, 3000), { hit: 2, of: 3 });
  assert.deepEqual(hitRate(t, 3000, ["2026-11-09", "2026-11-10", "2026-11-12"]), { hit: 1, of: 2 });
  assert.equal(litres(1750), "1.75");
  assert.equal(litres(3000), "3.0");
  assert.equal(litres(2500), "2.5");
  assert.equal(litres(0), "0.0");
});
