import { describe, it, expect } from "vitest";
import { monthPeriod, pricingFor, charges, chatsInPeriod, countEngaged } from "../lib/meter.js";
import { usageLabel } from "../lib/shopify/usage.js";

const plan = { name: "Client Connected Pro", amount: 549, includedMinutes: 1000, overagePerMin: 0.65, includedChats: 500, overagePerChat: 0.25, usageCap: 2500 };

describe("month period", () => {
  it("current and previous UTC month", () => {
    const now = new Date(Date.UTC(2026, 9, 8, 21));
    expect(monthPeriod(now)).toEqual({ key: "2026-10", start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) });
    expect(monthPeriod(new Date(Date.UTC(2027, 0, 3)), -1).key).toBe("2026-12");
  });
});

describe("pricing", () => {
  it("Shopify merchants get the Shopify plan, ignoring old per-org minutes", () => {
    const p = pricingFor({ shopDomain: "x.myshopify.com", includedMinutes: 500, plan: "Elite" }, plan);
    expect(p).toMatchObject({ shopify: true, planName: "Client Connected Pro", base: 549, includedMinutes: 1000, includedChats: 500, perChat: 0.25, usageCap: 2500 });
  });
  it("other customers keep their minutes; chats are not billed", () => {
    const p = pricingFor({ plan: "Starter", includedMinutes: 250 }, plan);
    expect(p).toMatchObject({ shopify: false, planName: "Starter", base: null, includedMinutes: 250, includedChats: null, usageCap: null });
  });
});

describe("charges", () => {
  const p = pricingFor({ shopDomain: "x" }, plan);
  it("nothing over the allowances = plan price only", () => {
    const c = charges({ minutes: 900, chats: 120, texts: 14 }, p);
    expect(c.usage).toBe(0);
    expect(c.total).toBe(549);
    expect(c.rows.map((r) => r.used)).toEqual([900, 120, 14]);
  });
  it("bills minute and chat overage separately and adds them", () => {
    const c = charges({ minutes: 1023, chats: 540, texts: 3 }, p);
    expect(c.rows[0]).toMatchObject({ over: 23, charge: 14.95 });
    expect(c.rows[1]).toMatchObject({ over: 40, charge: 10 });
    expect(c.rows[2].charge).toBe(0);
    expect(c.usage).toBe(24.95);
    expect(c.total).toBe(573.95);
  });
  it("caps usage at the spending limit", () => {
    const c = charges({ minutes: 6000, chats: 500 }, p);
    expect(c.usage).toBe(3250);
    expect(c.usageBilled).toBe(2500);
    expect(c.capped).toBe(true);
    expect(c.total).toBe(3049);
  });
  it("unknown texts stay null", () => {
    expect(charges({ minutes: 0, chats: 0, texts: null }, p).rows[2].used).toBeNull();
  });
  it("non-Shopify: minute overage only, no plan price", () => {
    const c = charges({ minutes: 300, chats: 900 }, pricingFor({ includedMinutes: 250 }, plan));
    expect(c.rows[1]).toMatchObject({ included: null, charge: 0 });
    expect(c.total).toBe(32.5);
  });
});

describe("chat counting", () => {
  const s = Date.UTC(2026, 9, 1), e = Date.UTC(2026, 10, 1);
  it("keeps web chats in the window only", () => {
    const list = [
      { chat_id: "a", start_timestamp: s },
      { chat_id: "b", start_timestamp: e },
      { chat_id: "c", start_timestamp: s + 5, chat_type: "sms_chat" },
      { chat_id: "d", start_timestamp: e - 1, chat_type: "api_chat" },
    ];
    expect(chatsInPeriod(list, s, e).map((c) => c.chat_id)).toEqual(["a", "d"]);
  });
  it("counts only chats where the visitor spoke; errors don't count", async () => {
    const chats = ["y1", "n1", "y2", "err", "y3"].map((chat_id) => ({ chat_id }));
    const n = await countEngaged(chats, async (c) => {
      if (c.chat_id === "err") throw new Error("x");
      return c.chat_id.startsWith("y");
    }, 2);
    expect(n).toBe(3);
  });
});

describe("usage record label", () => {
  it("names each medium that went over", () => {
    expect(usageLabel({ overMinutes: 23, overChats: 40 })).toBe("23 overage minutes, 40 overage chats");
    expect(usageLabel({ overMinutes: 1, overChats: 0 })).toBe("1 overage minute");
  });
});
