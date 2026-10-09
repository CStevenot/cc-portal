import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { adminGraphql } from "../../../../lib/shopify/api";
import { parseItems, approvedCodes, normCode, checkoutSms, promoLabel } from "../../../../lib/shopify/commerce";
import { getCodeDiscount } from "../../../../lib/shopify/discounts";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `create_checkout_link`.
// Args: { items: [{ variant_id, quantity }] (array or JSON string), discount_code? (ignored; kept for old agents) }
// Creates a draft order with NO customer attached and returns its checkout (invoice) URL,
// `checkout_sms` (the exact text Retell's In-Call SMS sends as a static sentence) and
// `draft_order_id` (pass to check_checkout_status to confirm the order on the call).
//
// Promotions: every code the merchant approved AND Shopify reports ACTIVE is tried.
// Order-level and product codes are kept only if Shopify's calculation actually applies
// them to this cart. Free-shipping codes can't be priced before an address exists, so
// they ride along on the checkout and Shopify applies them there if the cart qualifies.
const FAIL = (reason) => ({
  checkout_created: "false", checkout_url: "", checkout_total: "", checkout_sms: "", draft_order_id: "",
  discount_applied: "false", discount_summary: "", shipping_promo_pending: "", reason,
});

const CALC = `mutation($input: DraftOrderInput!) { draftOrderCalculate(input: $input) {
  calculatedDraftOrder { platformDiscounts { code summary totalAmount { amount } } }
  userErrors { message } } }`;

const CREATE = `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) {
  draftOrder { id invoiceUrl
    totalPriceSet { shopMoney { amount } } subtotalPriceSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } } }
  userErrors { field message } } }`;

async function eligibleCodes(t, lineItems) {
  const codes = approvedCodes(t.meta);
  if (!codes.length) return { apply: [], applied: [], shipping: [] };
  const live = (await Promise.all(codes.map((c) => getCodeDiscount(t.shop, t.token, c).catch(() => null))))
    .filter((d) => d && d.status === "ACTIVE" && d.code);
  const shipping = live.filter((d) => d.kind === "shipping");
  const priced = live.filter((d) => d.kind !== "shipping");
  let applied = [];
  if (priced.length) {
    const calc = await adminGraphql(t.shop, t.token, CALC, {
      input: { lineItems, discountCodes: priced.map((d) => normCode(d.code)) },
    }).catch(() => null);
    const hits = new Set((calc?.draftOrderCalculate?.calculatedDraftOrder?.platformDiscounts || [])
      .filter((p) => p.code && Number(p.totalAmount?.amount) > 0)
      .map((p) => normCode(p.code)));
    applied = priced.filter((d) => hits.has(normCode(d.code)));
  }
  return { apply: [...applied, ...shipping].map((d) => normCode(d.code)), applied, shipping };
}

async function create(t, lineItems, discountCodes) {
  const data = await adminGraphql(t.shop, t.token, CREATE, {
    input: {
      lineItems,
      discountCodes,
      // The channel tag lets the portal count checkout links texted during calls.
      tags: ["client-connected-agent", `client-connected-${t.channel || "unknown"}`],
      note: `Created by the Client Connected phone agent${t.callId ? ` (call ${t.callId})` : ""}.`,
      sourceName: "client-connected",
    },
  });
  return data?.draftOrderCreate;
}

export async function POST(req) {
  let t;
  try {
    t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json(FAIL(t.reason || "store_not_connected"));

    const lineItems = parseItems(t.args.items);
    if (!lineItems) return Response.json(FAIL("no_valid_items"));

    const promo = await eligibleCodes(t, lineItems).catch(() => ({ apply: [], applied: [], shipping: [] }));
    let res = await create(t, lineItems, promo.apply);
    let usedPromos = promo.apply.length > 0;
    // A code Shopify refuses must never cost the caller their checkout link: retry clean.
    if (usedPromos && (res?.userErrors?.length || !res?.draftOrder?.invoiceUrl)) {
      log("checkout_discount_retry", { shop: t.shop, callId: t.callId, errors: (res?.userErrors || []).map((e) => e.message) });
      res = await create(t, lineItems, []);
      usedPromos = false;
    }
    if (res?.userErrors?.length || !res?.draftOrder?.invoiceUrl) {
      log("checkout_error", { shop: t.shop, callId: t.callId, errors: (res?.userErrors || []).map((e) => e.message) });
      return Response.json(FAIL("shopify_rejected"));
    }
    const d = res.draftOrder;
    const num = (m) => { const n = Number(m?.shopMoney?.amount); return Number.isFinite(n) ? n.toFixed(2) : ""; };
    const savings = num(d.totalDiscountsSet);
    const applied = usedPromos ? promo.applied : [];
    const shipping = usedPromos ? promo.shipping : [];
    log("checkout_created", { shop: t.shop, callId: t.callId, draftOrderId: d.id, lines: lineItems.length, applied: applied.length, shipping: shipping.length });
    return Response.json({
      checkout_created: "true",
      checkout_url: d.invoiceUrl,
      draft_order_id: String(d.id || "").split("/").pop(),
      subtotal_before_discounts: num(d.subtotalPriceSet),
      checkout_total: num(d.totalPriceSet),
      total_note: "Before shipping and tax, which the caller sees at checkout.",
      checkout_sms: checkoutSms(t.meta.businessName || t.org?.name, d.invoiceUrl),
      discount_applied: applied.length ? "true" : "false",
      discount_summary: applied.map(promoLabel).join(" | "),
      discount_savings: Number(savings) > 0 ? savings : "",
      shipping_promo_pending: shipping.map(promoLabel).join(" | "),
      reason: "",
    });
  } catch (e) {
    log("checkout_error", { shop: t?.shop, callId: t?.callId, message: e?.message });
    return Response.json(FAIL("error"));
  }
}
