// Monthly overage metering for Shopify-billed merchants (pure helpers + the run).
import { allOrgsWithShop, accessTokenFor, patchPublic, agentIdsOf } from "./store";
import { adminGraphql, planFromEnv } from "./api";
import { listCallsForAgents } from "./retell";
import { log } from "./log";
import { emailOps } from "./notify";

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

const cents = (n) => Math.round(Number(n || 0) * 100) / 100;

// Shopify rejects a usage record that would push balanceUsed past cappedAmount, and a
// rejected record bills nothing. Bill what fits under the cap and report the rest.
export function clampToCap(amount, cappedAmount, balanceUsed) {
  const remaining = Math.max(0, cents(cappedAmount) - cents(balanceUsed));
  const bill = cents(Math.min(cents(amount), remaining));
  return { bill, unbilled: cents(cents(amount) - bill), remaining, clipped: bill < cents(amount) };
}

// Plain-text summary for ops when anything was clipped at the cap or failed.
export function usageAlert(period, results) {
  const bad = results.filter((r) => r.error || r.clipped);
  if (!bad.length) return null;
  const lines = bad.map((r) => r.error
    ? `- ${r.shop}: ERROR ${r.error} (minutes ${r.minutes ?? "?"}, overage $${r.amount ?? "?"}). Nothing billed; rerun after fixing.`
    : `- ${r.shop}: hit the usage cap. Billed $${r.billed}, unbilled $${r.unbilled} (${r.overMinutes} overage minutes). Ask the merchant to raise the spending limit, then bill the balance.`);
  return {
    subject: `Shopify usage billing ${period}: ${bad.length} shop(s) need attention`,
    text: `Monthly Shopify usage run for ${period}.\n\n${lines.join("\n")}\n`,
  };
}

async function usageLineItem(shop, token) {
  const data = await adminGraphql(shop, token, `{
    currentAppInstallation { activeSubscriptions { id status lineItems { id plan { pricingDetails { __typename
      ... on AppUsagePricing { cappedAmount { amount } balanceUsed { amount } } } } } } }
  }`);
  const sub = (data.currentAppInstallation.activeSubscriptions || []).find((s) => s.status === "ACTIVE");
  const li = sub?.lineItems?.find((l) => l.plan?.pricingDetails?.__typename === "AppUsagePricing");
  if (!li) return null;
  const d = li.plan.pricingDetails;
  return { id: li.id, cappedAmount: Number(d.cappedAmount?.amount || 0), balanceUsed: Number(d.balanceUsed?.amount || 0) };
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
        const c = clampToCap(r.amount, li.cappedAmount, li.balanceUsed);
        Object.assign(r, { billed: c.bill, unbilled: c.unbilled, clipped: c.clipped, capRemaining: c.remaining });
        if (c.bill > 0) {
          r.usageRecordId = await createUsageRecord(shop, token, li.id, c.bill,
            `${r.overMinutes} overage minutes (${period.key})${c.clipped ? `, capped at spending limit` : ""}`,
            `usage-${shop}-${period.key}`);
        }
      }
      await patchPublic(org.id, { lastUsageBilled: period.key, lastUsageMinutes: r.minutes });
    } catch (e) {
      r.error = e?.message || String(e);
    }
    log("shopify_usage", r);
    results.push(r);
  }
  const alert = dry ? null : usageAlert(period.key, results);
  if (alert) {
    const sent = await emailOps(alert.subject, alert.text).catch((e) => ({ sent: false, reason: e?.message }));
    log("shopify_usage_alert", { period: period.key, sent: sent?.sent ?? false });
  }
  return { period: period.key, results };
}
