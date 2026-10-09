import { describe, it, expect } from "vitest";
import {
  productSearchQuery, productSearchPlan, formatProducts, discountView, approvedCodes, isApproved,
  parseItems, checkoutSms, promoLabel, checkoutStatusView, MAX_QTY, MAX_LINES,
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
      .toEqual({ code: "WELCOME10", title: "Welcome", summary: "10% off", status: "ACTIVE", ends_at: "", kind: "basic" });
    expect(discountView({ codeDiscount: { __typename: "DiscountCodeFreeShipping", codes: { nodes: [{ code: "SHIP" }] } } }).kind).toBe("shipping");
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
  it("defaults the Shopify plan to Pro: $549, 1,000 min + 500 chats, $0.65/min, $0.25/chat, $2,500 cap", () => {
    for (const k of ["PLAN_NAME", "PLAN_PRICE", "PLAN_INCLUDED_MIN", "PLAN_OVERAGE_PER_MIN", "PLAN_INCLUDED_CHATS", "PLAN_OVERAGE_PER_CHAT", "PLAN_USAGE_CAP"]) delete process.env[k];
    expect(planFromEnv()).toEqual({ name: "Client Connected Pro", amount: 549, includedMinutes: 1000, overagePerMin: 0.65, includedChats: 500, overagePerChat: 0.25, usageCap: 2500 });
  });
});

describe("search plan", () => {
  it("widens a conversational ask: exact, then any meaningful word, then the catalog", () => {
    const plan = productSearchPlan("beginner all-mountain board");
    expect(plan.map((p) => p.match)).toEqual(["exact", "related", "catalog"]);
    expect(plan[1].q).toBe("(mountain* OR board*) AND status:active");
    expect(plan[2].q).toBe("status:active");
  });
  it("folds plurals and keeps operators out", () => {
    expect(productSearchPlan("snowboards")[1].q).toBe("(snowboard*) AND status:active");
    expect(productSearchPlan('status:draft OR "x"')[0].q).toBe("status draft x AND status:active");
  });
  it("goes straight to the catalog when the ask has no product words", () => {
    expect(productSearchPlan("").map((p) => p.match)).toEqual(["catalog"]);
    expect(productSearchPlan("just recommend something good").map((p) => p.match)).toEqual(["exact", "catalog"]);
  });
});

describe("formatProducts context", () => {
  it("adds type, a short description and how the match was found", () => {
    const out = formatProducts([{ title: "The Complete Snowboard", productType: "snowboard", description: "A board for every rider. ".repeat(20),
      variants: { nodes: [{ id: "gid://shopify/ProductVariant/9", title: "Ice", price: "699.95", availableForSale: true }] } }], "catalog");
    expect(out.match).toBe("catalog");
    expect(out.products[0].type).toBe("snowboard");
    expect(out.products[0].about.length).toBeLessThanOrEqual(140);
    expect(out.products_summary.startsWith("The Complete Snowboard (snowboard) - A board for every rider.")).toBe(true);
    expect(formatProducts([], "exact").match).toBe("none");
  });
});

describe("promo labels", () => {
  it("speaks the offer, never the code", () => {
    const label = promoLabel({ code: "FREESHIPPING2026", summary: "Free shipping on 3+ items", ends_at: "2026-12-31T00:00:00Z" });
    expect(label).toBe("Free shipping on 3+ items (ends 2026-12-31)");
    expect(label).not.toContain("FREESHIPPING2026");
    expect(promoLabel({ title: "Fall sale" })).toBe("Fall sale");
  });
});

describe("checkout status", () => {
  const base = { tags: ["client-connected-agent", "client-connected-voice"], note2: "Created by the Client Connected phone agent (call call_1).", status: "OPEN", order: null };
  it("is pending until Shopify completes the draft", () => {
    expect(checkoutStatusView(base, "call_1").checkout_status).toBe("pending");
  });
  it("confirms number, items and total once paid", () => {
    const v = checkoutStatusView({ ...base, status: "COMPLETED", order: { name: "#1002", displayFinancialStatus: "PAID",
      totalPriceSet: { shopMoney: { amount: "714.95" } }, totalDiscountsSet: { shopMoney: { amount: "0.0" } },
      lineItems: { nodes: [{ title: "The Complete Snowboard", variantTitle: "Ice", quantity: 1 }] } } }, "call_1");
    expect(v).toEqual({ checkout_status: "completed", order_number: "1002", order_total: "714.95", discount_total: "",
      items_summary: "1 x The Complete Snowboard (Ice)", payment_status: "paid" });
  });
  it("refuses drafts the agent didn't make on this call", () => {
    expect(checkoutStatusView({ ...base, tags: ["wholesale"] }, "call_1").checkout_status).toBe("not_found");
    expect(checkoutStatusView(base, "call_other").checkout_status).toBe("not_found");
    expect(checkoutStatusView(null, "call_1").checkout_status).toBe("not_found");
  });
});
