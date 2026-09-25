import { authenticate, errorResponse } from "../../../../lib/shopify/auth";
import { createSubscription, planFromEnv } from "../../../../lib/shopify/api";

export const dynamic = "force-dynamic";

// Start a Shopify-billed subscription (recurring + capped usage). Returns the approval URL.
export async function POST(req) {
  try {
    const { shop, accessToken } = await authenticate(req);
    const handle = shop.replace(".myshopify.com", "");
    const returnUrl = `https://admin.shopify.com/store/${handle}/apps/${process.env.SHOPIFY_APP_HANDLE || "client-connected"}`;
    const res = await createSubscription(shop, accessToken, planFromEnv(), returnUrl);
    return Response.json({ confirmationUrl: res.confirmationUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
