// Usage per medium (calls, chats, texts) and the charges it implies. Pure helpers only,
// shared by the portal's "This month" panel and the monthly Shopify usage billing run.

// UTC calendar month. offset 0 = this month, -1 = last month. end is exclusive.
export function monthPeriod(now = new Date(), offset = 0) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1);
  const d = new Date(start);
  return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, start, end };
}

const callSeconds = (c) =>
  c.duration_ms ? c.duration_ms / 1000
  : c.start_timestamp && c.end_timestamp ? (c.end_timestamp - c.start_timestamp) / 1000
  : 0;

// Billable minutes: total seconds of calls that started in [start, end), rounded up to whole minutes.
export function minutesInPeriod(calls, start, end) {
  const secs = calls
    .filter((c) => c.start_timestamp >= start && c.start_timestamp < end)
    .reduce((s, c) => s + callSeconds(c), 0);
  return Math.ceil(secs / 60);
}

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Pricing that applies to an org. Shopify-billed merchants are on the one Shopify plan,
// so the plan's allowances win over any older per-org includedMinutes. Other customers
// keep their per-org minutes; chats are counted for them but not billed.
export function pricingFor(meta = {}, plan) {
  const shopify = !!meta.shopDomain;
  return {
    shopify,
    planName: shopify ? plan.name : meta.plan || "Live",
    base: shopify ? plan.amount : null,
    includedMinutes: shopify ? plan.includedMinutes : Number(meta.includedMinutes) || 500,
    perMinute: plan.overagePerMin,
    includedChats: shopify ? plan.includedChats : null, // null = chats not billed
    perChat: shopify ? plan.overagePerChat : null,
    usageCap: shopify ? plan.usageCap : null,
  };
}

// Charges for one period. texts may be null when it can't be counted (store not connected).
export function charges({ minutes = 0, chats = 0, texts = null }, p) {
  const overMinutes = Math.max(0, minutes - p.includedMinutes);
  const minuteCharge = r2(overMinutes * p.perMinute);
  const chatsBilled = p.includedChats !== null && p.includedChats !== undefined;
  const overChats = chatsBilled ? Math.max(0, chats - p.includedChats) : 0;
  const chatCharge = chatsBilled ? r2(overChats * p.perChat) : 0;
  const usage = r2(minuteCharge + chatCharge);
  const usageBilled = p.usageCap ? r2(Math.min(usage, p.usageCap)) : usage;
  return {
    rows: [
      { medium: "calls", unit: "min", used: minutes, included: p.includedMinutes, over: overMinutes, rate: p.perMinute, charge: minuteCharge },
      { medium: "chats", unit: "chats", used: chats, included: chatsBilled ? p.includedChats : null, over: overChats, rate: chatsBilled ? p.perChat : null, charge: chatCharge },
      { medium: "texts", unit: "texts", used: texts, included: null, over: 0, rate: null, charge: 0 },
    ],
    overMinutes,
    overChats,
    usage,
    usageBilled,
    capped: usageBilled < usage,
    base: p.base,
    total: p.base === null || p.base === undefined ? usageBilled : r2(p.base + usageBilled),
  };
}

// Web chats that started in [start, end). SMS conversations are not web chats.
export const chatsInPeriod = (chats, start, end) =>
  chats.filter((c) => c.chat_type !== "sms_chat" && c.start_timestamp >= start && c.start_timestamp < end);

// A chat counts only if the visitor typed at least one message (a widget opened and
// left alone is free). isEngaged(chat) -> Promise<boolean>; runs a few at a time.
export async function countEngaged(chats, isEngaged, concurrency = 6) {
  let n = 0, i = 0;
  async function worker() {
    while (i < chats.length) {
      const c = chats[i++];
      try { if (await isEngaged(c)) n++; } catch { /* unknown: don't bill it */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chats.length) }, worker));
  return n;
}
