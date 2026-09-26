import { authenticate, errorResponse } from "../../../../lib/shopify/auth";
import { activeSubscription } from "../../../../lib/shopify/api";
import { patchPublic, agentIdsOf } from "../../../../lib/shopify/store";

export const dynamic = "force-dynamic";

// Embedded app load: verify session, match/provision the portal org, return status.
export async function POST(req) {
  try {
    const { shop, org, accessToken } = await authenticate(req);
    const sub = await activeSubscription(shop, accessToken).catch(() => null);
    const meta = org.publicMetadata || {};
    if (sub?.status === "ACTIVE" && meta.billing !== "shopify_active") {
      await patchPublic(org.id, { billing: "shopify_active", subscriptionId: sub.id });
    }
    return Response.json({
      shop,
      businessName: meta.businessName || org.name,
      agentsLinked: agentIdsOf(org).length,
      plan: meta.plan || "pending",
      subscription: sub ? { status: sub.status, test: sub.test } : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
