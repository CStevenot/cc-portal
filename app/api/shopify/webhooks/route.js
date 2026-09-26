import { after } from "next/server";
import { verifyShopifyWebhook } from "../../../../lib/shopify/crypto";
import { orgForShop, clearToken, patchPublic, agentIdsOf } from "../../../../lib/shopify/store";
import { listCallsForAgents, deleteCall } from "../../../../lib/shopify/retell";
import { buildDataReport, callsForCustomer } from "../../../../lib/shopify/datarequest";
import { emailOps } from "../../../../lib/shopify/notify";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mandatory compliance webhooks + app/uninstalled. HMAC-verified (401 on mismatch).
// Shopify expects a fast 200, so the work runs after the response via after().
export async function POST(req) {
  const raw = await req.text();
  if (!verifyShopifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_CLIENT_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") || "";
  const shop = req.headers.get("x-shopify-shop-domain") || "";
  let body = {};
  try { body = JSON.parse(raw || "{}"); } catch {}
  after(() => handle(topic, shop, body));
  return new Response(null, { status: 200 });
}

async function handle(topic, shop, body) {
  try {
    const org = shop ? await orgForShop(shop) : null;
    const agentIds = org ? agentIdsOf(org) : [];
    switch (topic) {
      case "app/uninstalled":
        if (org) {
          await clearToken(org.id);
          await patchPublic(org.id, { billing: "uninstalled", uninstalledAt: new Date().toISOString() });
        }
        log("shopify_uninstalled", { shop });
        break;
      case "customers/data_request": {
        const hits = callsForCustomer(await listCallsForAgents(agentIds), body?.customer);
        const report = buildDataReport({ shop, requestId: body?.data_request?.id, customer: body?.customer, calls: hits });
        const mail = await emailOps(`[Action, 30 days] Shopify data request: ${shop}`, report);
        log("gdpr_data_request", { shop, requestId: body?.data_request?.id, customerId: body?.customer?.id, calls: hits.length, emailed: mail.sent, reason: mail.reason });
        break;
      }
      case "customers/redact": {
        const hits = callsForCustomer(await listCallsForAgents(agentIds), body?.customer);
        for (const c of hits) await deleteCall(c.call_id);
        log("gdpr_customer_redact", { shop, customerId: body?.customer?.id, callsDeleted: hits.length });
        break;
      }
      case "shop/redact": {
        // Call records are wiped only for merchants who came in through Shopify.
        // A direct CC customer (e.g. PROOF) keeps its account data if it just drops the app.
        const viaShopify = (org?.publicMetadata || {}).channel === "shopify";
        const calls = viaShopify ? await listCallsForAgents(agentIds) : [];
        for (const c of calls) await deleteCall(c.call_id);
        if (org) {
          await clearToken(org.id);
          await patchPublic(org.id, { billing: "redacted", redactedAt: new Date().toISOString() });
        }
        log("gdpr_shop_redact", { shop, viaShopify, callsDeleted: calls.length });
        break;
      }
      default:
        log("webhook_ignored", { topic, shop });
    }
  } catch (e) {
    log("webhook_error", { topic, shop, message: e?.message });
    await emailOps(`[Error] Shopify webhook ${topic} for ${shop}`, `Handler failed: ${e?.message}. Check Vercel logs.`).catch(() => {});
  }
}
