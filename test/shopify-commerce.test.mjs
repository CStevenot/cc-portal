import { describe, it, expect } from "vitest";
import {
  productSearchQuery, formatProducts, discountView, approvedCodes, isApproved,
  parseItems, checkoutSms, MAX_QTY, MAX_LINES,
} from "../lib/shopify/commerce.js";
import { planFromEnv } from "../lib/shopify/api.js";

describe("product search query", () => {
  it("keeps plain words and forces active products", () => {
    expect(productSearchQuery("black bifold wallet")).toBe("black bifold wallet AND status:active");
  });
  it("strips search operators and quotes so callers can't widen the query", () => {
    expect(productSearchQuery('status:draft OR "x" vendor:*')).toBe("status draft x vendor AND status:active");
  });
  it("returns null for empty input", () => {
    expect(productSearchQuery("  ")).toBeNull();
    expect(productSearchQuery(undefined)).toBeNull();
  });
});

describe("formatProducts", () => {
  it("returns numeric variant ids, prices and a voice summary", () => {
    const out = formatProducts([{ title: "Bifold", variants: { nodes: [
      { id: "gid://shopify/ProductVariant/111", title: "Black", price: "79.00", compareAtPrice: null, availableForSale: true },
      { id: "gid://shopify/ProductVariant/112", title: "Brown", price: "79", compareAtPrice: "99", availableForSale: false },
    ] } }]);
    expect(out.products_found).toBe("true");
    expect(out.products[0].variants[0]).toEqual({ variant_id: "111", option: "Black", price: "79.00", compare_at_price: "", available: "true" });
    expect(out.products_summary).toContain("Brown $79.00 (sold out) [id 112]");
  });
  it("handles no results", () => {
    expect(formatProducts([]).products_found).toBe("false");
  });
});

describe("promos", () => {
  it("normalizes and dedupes approved codes", () => {
    expect(approvedCodes({ agentPromoCodes: ["welcome10", " WELCOME10 ", "VIP"] })).toEqual(["WELCOME10", "VIP"]);
    expect(approvedCodes({})).toEqual([]);
  });
  it("approves only listed codes", () => {
    const meta = { agentPromoCodes: ["WELCOME10"] };
    expect(isApproved("welcome10", meta)).toBe(true);
    expect(isApproved("FREE100", meta)).toBe(false);
    expect(isApproved("", meta)).toBe(false);
  });
  it("reads the code discount union shape", () => {
    expect(discountView({ codeDiscount: { title: "Welcome", summary: "10% off", status: "ACTIVE", endsAt: null, codes: { nodes: [{ code: "WELCOME10" }] } } }))
      .toEqual({ code: "WELCOME10", title: "Welcome", summary: "10% off", status: "ACTIVE", ends_at: "" });
  });
});

describe("checkout items", () => {
  it("accepts arrays and JSON strings, merges duplicates, caps quantity", () => {
    const lines = parseItems('[{"variant_id":"111","quantity":2},{"variant_id":"gid://shopify/ProductVariant/111","quantity":20}]');
    expect(lines).toEqual([{ variantId: "gid://shopify/ProductVariant/111", quantity: MAX_QTY }]);
  });
  it("rejects junk", () => {
    expect(parseItems("not json")).toBeNull();
    expect(parseItems([{ variant_id: "", quantity: 1 }, { variant_id: "5", quantity: 0 }])).toBeNull();
    expect(parseItems({ variant_id: "5" })).toBeNull();
  });
  it("limits line count", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ variant_id: String(i + 1), quantity: 1 }));
    expect(parseItems(many)).toHaveLength(MAX_LINES);
  });
  it("defaults quantity to 1", () => {
    expect(parseItems([{ variant_id: "7" }])).toEqual([{ variantId: "gid://shopify/ProductVariant/7", quantity: 1 }]);
  });
});

describe("checkout sms + plan", () => {
  it("builds the fixed text with opt-out", () => {
    const s = checkoutSms("PROOF", "https://x.myshopify.com/1/invoices/abc");
    expect(s).toBe("PROOF: here's the checkout link you asked for: https://x.myshopify.com/1/invoices/abc Reply STOP to opt out.");
  });
  it("defaults the Shopify plan to Pro at $549 + $0.65/min, $2,500 cap", () => {
    for (const k of ["PLAN_NAME", "PLAN_PRICE", "PLAN_INCLUDED_MIN", "PLAN_OVERAGE_PER_MIN", "PLAN_USAGE_CAP"]) delete process.env[k];
    expect(planFromEnv()).toEqual({ name: "Client Connected Pro", amount: 549, includedMinutes: 500, overagePerMin: 0.65, usageCap: 2500 });
  });
});
