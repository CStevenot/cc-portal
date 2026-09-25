import { verifyRetell } from "../../../../lib/shopify/crypto";
import { orgForAgent, accessTokenFor } from "../../../../lib/shopify/store";
import { adminGraphql } from "../../../../lib/shopify/api";
import { after } from "next/server";
import { accessLog, log } from "../../../../lib/shopify/log";
import { tagCallAccess } from "../../../../lib/shopify/retell";
import { contactMatches, mapStatus, digits } from "../../../../lib/shopify/order";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `lookup_order`. Status only when the caller's email/phone matches the order.
const EMPTY = {
  lookup_found: "false", lookup_verified: "false", order_status: "unknown",
  order_summary: "", tracking_company: "", tracking_number: "", cancelled: "false",
};

// Log the access and attach it to the Retell call after the response is sent.
function audit(data) {
  const entry = accessLog(data);
  after(() => tagCallAccess(data.callId, entry).catch((e) => log("pcd_access_tag_failed", { callId: data.callId, message: e?.message })));
}

export async function POST(req) {
  const raw = await req.text();
  if (!verifyRetell(raw, req.headers.get("x-retell-signature"), process.env.RETELL_API_KEY)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json(EMPTY); }
  const args = body.args ?? body;
  const agentId = body.call?.agent_id;
  const callId = body.call?.call_id;
  const orderNumber = digits(String(args.order_number || ""));
  const contact = String(args.customer_contact || "");
  if (!agentId || !orderNumber || !contact) return Response.json(EMPTY);

  let shop = "";
  try {
    const org = await orgForAgent(agentId);
    shop = (org?.publicMetadata || {}).shopDomain || "";
    const token = org && shop ? await accessTokenFor(org, shop) : null;
    if (!token) return Response.json(EMPTY);

    const data = await adminGraphql(shop, token, `query($q: String!) { orders(first: 1, query: $q) { nodes {
      email phone cancelledAt displayFulfillmentStatus customer { email phone }
      lineItems(first: 10) { nodes { name quantity } }
      fulfillments(first: 5) { displayStatus trackingInfo(first: 1) { company number } } } } }`,
      { q: `name:#${orderNumber}` });
    const order = data?.orders?.nodes?.[0];
    if (!order) { audit({ shop, callId, orderRef: orderNumber, result: "not_found" }); return Response.json(EMPTY); }

    const ok = contactMatches(contact, order.email || order.customer?.email, order.phone || order.customer?.phone);
    audit({ shop, callId, orderRef: orderNumber, result: ok ? "verified" : "mismatch" });
    if (!ok) return Response.json({ ...EMPTY, lookup_found: "true" });

    const t = order.fulfillments?.[0]?.trackingInfo?.[0] || {};
    return Response.json({
      lookup_found: "true", lookup_verified: "true",
      order_status: order.cancelledAt ? "unknown" : mapStatus(order),
      order_summary: (order.lineItems?.nodes || []).map((li) => `${li.quantity} x ${li.name}`).join(", ").slice(0, 300),
      tracking_company: String(t.company || ""), tracking_number: String(t.number || ""),
      cancelled: order.cancelledAt ? "true" : "false",
    });
  } catch {
    audit({ shop, callId, orderRef: orderNumber, result: "error" });
    return Response.json(EMPTY);
  }
}
