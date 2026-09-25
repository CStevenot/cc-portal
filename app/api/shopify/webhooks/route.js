import { verifyShopifyWebhook } from "../../../../lib/shopify/crypto";
import { orgForShop, clearToken, patchPublic, agentIdsOf } from "../../../../lib/shopify/store";
import { listCallsForAgents, deleteCall, matchesCustomer } from "../../../../lib/shopify/retell";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mandatory compliance webhooks + app/uninstalled. HMAC-verified; 401 on mismatch.
export async function POST(req) {
  const raw = await req.text();
  if (!verifyShopifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), process.env.SHOPIFY_CLIENT_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") || "";
  const shop = req.headers.get("x-shopify-shop-domain") || "";
  const body = JSON.parse(raw || "{}");
  const org = shop ? await orgForShop(shop) : null;
  const agentIds = org ? agentIdsOf(org) : [];

  try {
    switch (topic) {
      case "app/uninstalled":
        if (org) {
          await clearToken(org.id);
          await patchPublic(org.id, { billing: "uninstalled", uninstalledAt: new Date().toISOString() });
        }
        break;
      case "customers/data_request":
        // No Shopify data is persisted; Retell call records (90-day retention) may hold caller-stated data.
        // Logged for manual fulfilment to the merchant within 30 days. No PII in the log line.
        log("gdpr_data_request", { shop, requestId: body?.data_request?.id, customerId: body?.customer?.id });
        break;
      case "customers/redact": {
        const emails = [body?.customer?.email].filter(Boolean);
        const phones = [body?.customer?.phone].filter(Boolean);
        const hits = (await listCallsForAgents(agentIds)).filter((c) => matchesCustomer(c, emails, phones));
        for (const c of hits) await deleteCall(c.call_id);
        log("gdpr_customer_redact", { shop, customerId: body?.customer?.id, callsDeleted: hits.length });
        break;
      }
      case "shop/redact": {
        const calls = await listCallsForAgents(agentIds);
        for (const c of calls) await deleteCall(c.call_id);
        if (org) {
          await clearToken(org.id);
          await patchPublic(org.id, { billing: "redacted", redactedAt: new Date().toISOString() });
        }
        log("gdpr_shop_redact", { shop, callsDeleted: calls.length });
        break;
      }
      default:
        log("webhook_ignored", { topic, shop });
    }
    return new Response(null, { status: 200 });
  } catch (e) {
    log("webhook_error", { topic, shop, message: e?.message });
    return new Response("error", { status: 500 });
  }
}
