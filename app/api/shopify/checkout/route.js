import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { adminGraphql } from "../../../../lib/shopify/api";
import { parseItems, isApproved, normCode, checkoutSms } from "../../../../lib/shopify/commerce";
import { getCodeDiscount } from "../../../../lib/shopify/discounts";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `create_checkout_link`.
// Args: { items: [{ variant_id, quantity }] (array or JSON string), discount_code? }
// Creates a draft order with NO customer attached and returns its checkout (invoice) URL
// plus `checkout_sms`, the exact text Retell's In-Call SMS sends as a static sentence.
// A discount code is applied only if the merchant approved it AND Shopify says it's active.
const FAIL = (reason) => ({ checkout_created: "false", checkout_url: "", checkout_total: "", checkout_sms: "", discount_applied: "false", reason });

export async function POST(req) {
  let t;
  try {
    t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json(FAIL(t.reason || "store_not_connected"));

    const lineItems = parseItems(t.args.items);
    if (!lineItems) return Response.json(FAIL("no_valid_items"));

    let discountCodes = [];
    let discountNote = "";
    const requested = normCode(t.args.discount_code);
    if (requested) {
      if (!isApproved(requested, t.meta)) {
        discountNote = "code_not_approved";
      } else {
        const d = await getCodeDiscount(t.shop, t.token, requested).catch(() => null);
        if (d?.status === "ACTIVE") discountCodes = [requested];
        else discountNote = "code_not_active";
      }
    }

    const data = await adminGraphql(t.shop, t.token, `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id invoiceUrl totalPriceSet { shopMoney { amount currencyCode } } }
        userErrors { field message } } }`, {
      input: {
        lineItems,
        discountCodes,
        // The channel tag lets the portal count checkout links texted during calls.
        tags: ["client-connected-agent", `client-connected-${t.channel || "unknown"}`],
        note: `Created by the Client Connected phone agent${t.callId ? ` (call ${t.callId})` : ""}.`,
        sourceName: "client-connected",
      },
    });
    const res = data?.draftOrderCreate;
    if (res?.userErrors?.length || !res?.draftOrder?.invoiceUrl) {
      log("checkout_error", { shop: t.shop, callId: t.callId, errors: (res?.userErrors || []).map((e) => e.message) });
      return Response.json(FAIL("shopify_rejected"));
    }
    const d = res.draftOrder;
    const total = Number(d.totalPriceSet?.shopMoney?.amount);
    log("checkout_created", { shop: t.shop, callId: t.callId, draftOrderId: d.id, lines: lineItems.length, discount: discountCodes[0] || "" });
    return Response.json({
      checkout_created: "true",
      checkout_url: d.invoiceUrl,
      checkout_total: Number.isFinite(total) ? total.toFixed(2) : "",
      checkout_sms: checkoutSms(t.meta.businessName || t.org?.name, d.invoiceUrl),
      discount_applied: discountCodes.length ? "true" : "false",
      reason: discountNote,
    });
  } catch (e) {
    log("checkout_error", { shop: t?.shop, callId: t?.callId, message: e?.message });
    return Response.json(FAIL("error"));
  }
}
