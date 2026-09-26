// Monthly overage metering for Shopify-billed merchants (pure helpers + the run).
import { allOrgsWithShop, accessTokenFor, patchPublic, agentIdsOf } from "./store";
import { adminGraphql, planFromEnv } from "./api";
import { listCallsForAgents } from "./retell";
import { log } from "./log";

// Previous calendar month in UTC: { key: "2026-08", start, end } (ms, end exclusive).
export function previousMonth(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
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

export function overage(minutes, included, ratePerMin) {
  const over = Math.max(0, minutes - included);
  return { overMinutes: over, amount: Math.round(over * ratePerMin * 100) / 100 };
}

async function usageLineItem(shop, token) {
  const data = await adminGraphql(shop, token, `{
    currentAppInstallation { activeSubscriptions { id status lineItems { id plan { pricingDetails { __typename } } } } }
  }`);
  const sub = (data.currentAppInstallation.activeSubscriptions || []).find((s) => s.status === "ACTIVE");
  const li = sub?.lineItems?.find((l) => l.plan?.pricingDetails?.__typename === "AppUsagePricing");
  return li?.id || null;
}

async function createUsageRecord(shop, token, lineItemId, amount, description, key) {
  const data = await adminGraphql(shop, token, `
    mutation Use($id: ID!, $price: MoneyInput!, $description: String!, $key: String) {
      appUsageRecordCreate(subscriptionLineItemId: $id, price: $price, description: $description, idempotencyKey: $key) {
        appUsageRecord { id }
        userErrors { field message }
      }
    }`, { id: lineItemId, price: { amount, currencyCode: "USD" }, description, key });
  const res = data.appUsageRecordCreate;
  if (res.userErrors?.length) throw new Error(res.userErrors.map((e) => e.message).join("; "));
  return res.appUsageRecord?.id;
}

// One pass over every active Shopify merchant. dry=true computes without billing.
export async function runMonthlyUsage({ now = new Date(), dry = false } = {}) {
  const period = previousMonth(now);
  const plan = planFromEnv();
  const results = [];
  for (const org of await allOrgsWithShop()) {
    const meta = org.publicMetadata || {};
    const shop = meta.shopDomain;
    const r = { shop, period: period.key };
    try {
      if (meta.billing !== "shopify_active") { r.skipped = "billing not active"; results.push(r); continue; }
      if (meta.lastUsageBilled === period.key) { r.skipped = "already billed"; results.push(r); continue; }
      const included = Number(meta.includedMinutes) || plan.includedMinutes;
      const calls = await listCallsForAgents(agentIdsOf(org));
      r.minutes = minutesInPeriod(calls, period.start, period.end);
      Object.assign(r, { included }, overage(r.minutes, included, plan.overagePerMin));
      if (dry) { r.dry = true; results.push(r); continue; }
      if (r.amount > 0) {
        const token = await accessTokenFor(org, shop);
        if (!token) throw new Error("no access token");
        const li = await usageLineItem(shop, token);
        if (!li) throw new Error("no usage line item on active subscription");
        r.usageRecordId = await createUsageRecord(shop, token, li, r.amount,
          `${r.overMinutes} overage minutes (${period.key})`, `usage-${shop}-${period.key}`);
      }
      await patchPublic(org.id, { lastUsageBilled: period.key, lastUsageMinutes: r.minutes });
    } catch (e) {
      r.error = e?.message || String(e);
    }
    log("shopify_usage", r);
    results.push(r);
  }
  return { period: period.key, results };
}
