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
