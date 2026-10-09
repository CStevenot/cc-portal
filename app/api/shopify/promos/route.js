import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { approvedCodes, promoLabel } from "../../../../lib/shopify/commerce";
import { getCodeDiscount } from "../../../../lib/shopify/discounts";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `get_promotions`. No args. Returns ONLY the promotions the merchant
// approved for the agent in the app, and only those Shopify reports as ACTIVE right now.
// The agent gets plain-language labels, never the codes: create_checkout_link applies
// every eligible approved code to the checkout link by itself.
const EMPTY = { promos_available: "false", promos_summary: "", promos: [] };

export async function POST(req) {
  try {
    const t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json({ ...EMPTY, reason: t.reason });
    const codes = approvedCodes(t.meta);
    if (!codes.length) return Response.json(EMPTY);
    const live = await Promise.all(codes.map((c) => getCodeDiscount(t.shop, t.token, c).catch(() => null)));
    const promos = live
      .filter((d) => d && d.status === "ACTIVE")
      .map((d) => ({ label: promoLabel(d), kind: d.kind, ends_at: d.ends_at }))
      .filter((p) => p.label);
    log("promo_list", { shop: t.shop, callId: t.callId, approved: codes.length, active: promos.length });
    return Response.json({
      promos_available: promos.length ? "true" : "false",
      promos_summary: promos.map((p) => p.label).join(" | ").slice(0, 800),
      promos,
      how_applied: promos.length ? "Applied automatically to the checkout link when the cart qualifies. No code needed." : "",
    });
  } catch (e) {
    log("promo_list_error", { message: e?.message });
    return Response.json(EMPTY);
  }
}
