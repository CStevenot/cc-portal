// Shared entry for Retell custom-function routes: verify the Retell signature,
// map the calling agent to its portal org and store, and get a Shopify token.
import { verifyRetell } from "./crypto";
import { orgForAgent, accessTokenFor } from "./store";

export async function retellTool(req) {
  const raw = await req.text();
  // Retell signs custom-function calls with the API key marked "Webhook" in its dashboard.
  const key = process.env.RETELL_WEBHOOK_KEY || process.env.RETELL_API_KEY;
  if (!key || !verifyRetell(raw, req.headers.get("x-retell-signature"), key)) {
    return { unauthorized: true };
  }
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false }; }
  const args = body.args ?? body;
  // Voice agents send `call`; chat agents send `chat`.
  const ctx = body.call || body.chat || {};
  const channel = body.call ? "voice" : body.chat ? "chat" : "unknown";
  const agentId = ctx.agent_id;
  const callId = ctx.call_id || ctx.chat_id;
  if (!agentId) return { ok: false, reason: "no_agent_id", args, callId };
  const org = await orgForAgent(agentId);
  if (!org) return { ok: false, reason: "agent_not_linked", args, callId };
  const meta = org.publicMetadata || {};
  const shop = meta.shopDomain || "";
  if (!shop) return { ok: false, reason: "no_shop_on_org", args, callId };
  const token = await accessTokenFor(org, shop);
  if (!token) return { ok: false, reason: "store_not_connected", args, callId, shop };
  return { ok: true, args, callId, agentId, channel, org, meta, shop, token };
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
