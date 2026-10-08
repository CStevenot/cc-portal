import { describe, it, expect } from "vitest";
import { previousMonth, minutesInPeriod, overage } from "../lib/shopify/usage.js";
import { buildDataReport, callsForCustomer } from "../lib/shopify/datarequest.js";

describe("usage metering", () => {
  it("computes the previous UTC calendar month, across a year boundary", () => {
    const p = previousMonth(new Date(Date.UTC(2027, 0, 1, 9, 17)));
    expect(p.key).toBe("2026-12");
    expect(p.start).toBe(Date.UTC(2026, 11, 1));
    expect(p.end).toBe(Date.UTC(2027, 0, 1));
  });
  it("sums only calls that started in the period and rounds up to whole minutes", () => {
    const s = Date.UTC(2026, 7, 1), e = Date.UTC(2026, 8, 1);
    const calls = [
      { start_timestamp: s, duration_ms: 90_000 },
      { start_timestamp: e - 1, end_timestamp: e - 1 + 31_000 },
      { start_timestamp: e, duration_ms: 600_000 },
      { start_timestamp: s - 1, duration_ms: 600_000 },
    ];
    expect(minutesInPeriod(calls, s, e)).toBe(3);
  });
  it("bills only minutes over the included amount", () => {
    expect(overage(400, 500, 0.65)).toEqual({ overMinutes: 0, amount: 0 });
    expect(overage(523, 500, 0.65)).toEqual({ overMinutes: 23, amount: 14.95 });
  });
});

describe("data request", () => {
  const calls = [
    { call_id: "a", from_number: "+16145550148", start_timestamp: 0, transcript: "hi" },
    { call_id: "b", from_number: "+12125550000", collected_dynamic_variables: { customer_contact: "Jo@X.com" } },
    { call_id: "c", from_number: "+13105550000" },
  ];
  it("matches the customer's calls by phone or stated email", () => {
    expect(callsForCustomer(calls, { email: "jo@x.com", phone: "614-555-0148" }).map((c) => c.call_id)).toEqual(["a", "b"]);
    expect(callsForCustomer(calls, {})).toEqual([]);
  });
  it("builds a report listing each call", () => {
    const r = buildDataReport({ shop: "s.myshopify.com", requestId: 9, customer: { id: 1 }, calls: calls.slice(0, 1) });
    expect(r).toContain("Matching calls: 1");
    expect(r).toContain("--- Call a");
    expect(r).toContain("stores no Shopify order data");
  });
});

import { clampToCap, usageAlert } from "../lib/shopify/usage.js";

describe("usage cap", () => {
  it("bills the full amount when it fits under the cap", () => {
    expect(clampToCap(300, 2500, 0)).toEqual({ bill: 300, unbilled: 0, remaining: 2500, clipped: false });
  });
  it("bills only what fits and reports the rest", () => {
    expect(clampToCap(3000.5, 2500, 100)).toEqual({ bill: 2400, unbilled: 600.5, remaining: 2400, clipped: true });
  });
  it("bills nothing when the cap is already used", () => {
    expect(clampToCap(50, 2500, 2500)).toEqual({ bill: 0, unbilled: 50, remaining: 0, clipped: true });
  });
  it("alerts ops only for clipped or failed shops", () => {
    expect(usageAlert("2026-10", [{ shop: "a", amount: 0 }])).toBeNull();
    const a = usageAlert("2026-10", [
      { shop: "a", billed: 2400, unbilled: 600.5, overMinutes: 4616, clipped: true },
      { shop: "b", error: "no access token", minutes: 900, amount: 260 },
      { shop: "c", amount: 10, billed: 10 },
    ]);
    expect(a.subject).toContain("2 shop(s)");
    expect(a.text).toContain("a: hit the usage cap. Billed $2400, unbilled $600.5");
    expect(a.text).toContain("b: ERROR no access token");
    expect(a.text).not.toContain("- c:");
  });
});
