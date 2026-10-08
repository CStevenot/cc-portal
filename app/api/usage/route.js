import { orgAgents } from "../../../lib/chat";
import { planFromEnv } from "../../../lib/shopify/api";
import { accessTokenFor } from "../../../lib/shopify/store";
import { monthPeriod, pricingFor, charges } from "../../../lib/meter";
import { usageCounts } from "../../../lib/usage-data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Org-scoped usage for the current UTC calendar month, per medium, with the charges it
// implies so far. Read live from Retell and the merchant's store; nothing is stored.
export async function GET() {
  if (!process.env.RETELL_API_KEY) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });
  const o = await orgAgents();
  if (o.error) return Response.json({ error: o.error }, { status: o.status });
  const meta = o.org.publicMetadata || {};
  const period = monthPeriod();
  const p = pricingFor(meta, planFromEnv());
  try {
    const shop = meta.shopDomain || "";
    const token = shop ? await accessTokenFor(o.org, shop).catch(() => null) : null;
    const counts = await usageCounts({ agentIds: o.agentIds, shop, token, start: period.start, end: period.end });
    return Response.json({
      period: period.key,
      start: period.start,
      asOf: Date.now(),
      plan: p.planName,
      shopify: p.shopify,
      usageCap: p.usageCap,
      ...charges(counts, p),
    });
  } catch (e) {
    return Response.json({ error: "usage_unavailable", detail: String(e?.message || e) }, { status: 502 });
  }
}
