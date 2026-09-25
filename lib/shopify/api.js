import { jwtVerify } from "jose";

export const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
const API_VERSION = () => process.env.SHOPIFY_API_VERSION || "2026-07";
const CLIENT_ID = () => process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = () => process.env.SHOPIFY_CLIENT_SECRET;

// Verify an App Bridge session token (JWT, HS256, signed with the app's client secret).
export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(CLIENT_SECRET()), {
    algorithms: ["HS256"],
    audience: CLIENT_ID(),
    clockTolerance: 10,
  });
  const dest = String(payload.dest || "");
  const shop = dest.replace(/^https:\/\//, "");
  if (!SHOP_RE.test(shop)) throw new Error("bad dest");
  if (!String(payload.iss || "").startsWith(dest)) throw new Error("iss/dest mismatch");
  return { shop, sub: payload.sub };
}

function toToken(j) {
  const now = Date.now();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? now + Number(j.expires_in) * 1000 : undefined,
    refreshExpiresAt: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : undefined,
    scope: String(j.scope || ""),
  };
}

async function tokenCall(shop, body) {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), ...body }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  return toToken(await r.json());
}

// Token exchange: session token -> expiring offline token (required for public apps by 2027-01-01).
export function exchangeForOfflineToken(shop, sessionToken) {
  return tokenCall(shop, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });
}

export function refreshOfflineToken(shop, refreshToken) {
  return tokenCall(shop, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function adminGraphql(shop, accessToken, query, variables = {}) {
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION()}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`graphql ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error("graphql errors");
  return j.data;
}

// ---- Billing: Shopify-billed recurring base + capped usage (overage minutes) ----
export function planFromEnv() {
  return {
    name: process.env.PLAN_NAME || "Client Connected",
    amount: Number(process.env.PLAN_PRICE || "349"),
    includedMinutes: Number(process.env.PLAN_INCLUDED_MIN || "500"),
    overagePerMin: Number(process.env.PLAN_OVERAGE_PER_MIN || "0.65"),
    usageCap: Number(process.env.PLAN_USAGE_CAP || "500"),
  };
}

export async function createSubscription(shop, accessToken, plan, returnUrl) {
  const data = await adminGraphql(shop, accessToken, `
    mutation Sub($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
        confirmationUrl
        appSubscription { id status }
        userErrors { field message }
      }
    }`, {
    name: plan.name,
    returnUrl,
    test: process.env.BILLING_TEST !== "false",
    lineItems: [
      { plan: { appRecurringPricingDetails: { price: { amount: plan.amount, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } },
      { plan: { appUsagePricingDetails: {
        cappedAmount: { amount: plan.usageCap, currencyCode: "USD" },
        terms: `${plan.includedMinutes} minutes included; $${plan.overagePerMin.toFixed(2)} per additional minute`,
      } } },
    ],
  });
  const res = data.appSubscriptionCreate;
  if (res.userErrors?.length) throw new Error(res.userErrors.map((e) => e.message).join("; "));
  return res;
}

export async function activeSubscription(shop, accessToken) {
  const data = await adminGraphql(shop, accessToken, `{
    currentAppInstallation { activeSubscriptions { id name status test lineItems { id } } }
  }`);
  return data.currentAppInstallation.activeSubscriptions?.[0] || null;
}

// Record overage usage against the usage line item (for the monthly metering job).
export async function recordUsage(shop, accessToken, usageLineItemId, amount, description, idempotencyKey) {
  const data = await adminGraphql(shop, accessToken, `
    mutation Use($id: ID!, $price: MoneyInput!, $description: String!, $key: String) {
      appUsageRecordCreate(subscriptionLineItemId: $id, price: $price, description: $description, idempotencyKey: $key) {
        appUsageRecord { id }
        userErrors { field message }
      }
    }`, { id: usageLineItemId, price: { amount, currencyCode: "USD" }, description, key: idempotencyKey });
  const res = data.appUsageRecordCreate;
  if (res.userErrors?.length) throw new Error(res.userErrors.map((e) => e.message).join("; "));
  return res.appUsageRecord;
}
