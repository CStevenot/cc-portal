import { authenticate, errorResponse, HttpError } from "../../../../lib/shopify/auth";
import { listActiveCodeDiscounts } from "../../../../lib/shopify/discounts";
import { approvedCodes, normCode } from "../../../../lib/shopify/commerce";
import { patchPublic } from "../../../../lib/shopify/store";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";

// Embedded app: the merchant chooses which of its active discount codes the agent may offer.
// POST {}                -> { discounts: [...active], approved: [...codes] }
// POST { save: [codes] } -> saves the subset that is currently active, returns the same shape.
export async function POST(req) {
  try {
    const { shop, org, accessToken } = await authenticate(req);
    let body = {};
    try { body = await req.json(); } catch {}
    const discounts = await listActiveCodeDiscounts(shop, accessToken);
    let approved = approvedCodes(org.publicMetadata);
    if (Array.isArray(body.save)) {
      if (body.save.length > 20) throw new HttpError(400, "too many codes");
      const active = new Set(discounts.map((d) => normCode(d.code)));
      approved = [...new Set(body.save.map(normCode))].filter((c) => active.has(c));
      await patchPublic(org.id, { agentPromoCodes: approved });
      log("promo_settings_saved", { shop, count: approved.length });
    }
    return Response.json({ discounts, approved });
  } catch (e) {
    return errorResponse(e);
  }
}
