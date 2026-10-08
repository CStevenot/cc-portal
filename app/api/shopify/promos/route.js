import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { approvedCodes } from "../../../../lib/shopify/commerce";
import { getCodeDiscount } from "../../../../lib/shopify/discounts";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `get_promotions`. No args. Returns ONLY the codes the merchant
// approved for the agent in the app, and only those Shopify reports as ACTIVE right now.
const EMPTY = { promos_available: "false", promos_summary: "", promos: [] };

export async function POST(req) {
  try {
    const t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json({ ...EMPTY, reason: t.reason });
    const codes = approvedCodes(t.meta);
    if (!codes.length) return Response.json(EMPTY);
    const live = await Promise.all(codes.map((c) => getCodeDiscount(t.shop, t.token, c).catch(() => null)));
    const promos = live.filter((d) => d && d.status === "ACTIVE");
    log("promo_list", { shop: t.shop, callId: t.callId, approved: codes.length, active: promos.length });
    return Response.json({
      promos_available: promos.length ? "true" : "false",
      promos_summary: promos.map((p) => `${p.code}: ${p.summary || p.title}${p.ends_at ? ` (ends ${p.ends_at.slice(0, 10)})` : ""}`).join(" | ").slice(0, 800),
      promos,
    });
  } catch (e) {
    log("promo_list_error", { message: e?.message });
    return Response.json(EMPTY);
  }
}
