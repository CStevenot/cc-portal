import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { adminGraphql } from "../../../../lib/shopify/api";
import { checkoutStatusView } from "../../../../lib/shopify/commerce";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `check_checkout_status`. Args: { draft_order_id }.
// Lets the agent stay on the line while the caller pays, then confirm the order out loud.
// Only answers for a draft order the agent created on THIS call (agent tag + call id in
// the note), and returns only order number, items and totals - no buyer details.
const PENDING = { checkout_status: "not_found", order_number: "", order_total: "", items_summary: "", payment_status: "" };

const Q = `query($id: ID!) { draftOrder(id: $id) { status tags note2
  order { name displayFinancialStatus
    totalPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } }
    lineItems(first: 10) { nodes { title variantTitle quantity } } } } }`;

export async function POST(req) {
  let t;
  try {
    t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json({ ...PENDING, reason: t.reason });
    const id = String(t.args.draft_order_id ?? "").replace(/\D/g, "");
    if (!id) return Response.json({ ...PENDING, reason: "no_draft_order_id" });
    const data = await adminGraphql(t.shop, t.token, Q, { id: `gid://shopify/DraftOrder/${id}` });
    const out = { ...PENDING, ...checkoutStatusView(data?.draftOrder, t.callId) };
    log("checkout_status", { shop: t.shop, callId: t.callId, status: out.checkout_status });
    return Response.json(out);
  } catch (e) {
    log("checkout_status_error", { shop: t?.shop, callId: t?.callId, message: e?.message });
    return Response.json({ ...PENDING, reason: "error" });
  }
}
