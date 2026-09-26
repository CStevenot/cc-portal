import { runMonthlyUsage } from "../../../../lib/shopify/usage";
import { safeEqual } from "../../../../lib/shopify/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (vercel.json, 1st of the month) bills last month's overage minutes
// to each Shopify merchant. Vercel sends "Authorization: Bearer $CRON_SECRET".
// Manual dry run: GET with the same header and ?dry=1 -> computes, bills nothing.
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  return Response.json(await runMonthlyUsage({ dry }));
}
