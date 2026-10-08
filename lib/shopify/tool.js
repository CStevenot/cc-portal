// Shared entry for Retell custom-function routes: verify the Retell signature,
// map the calling agent to its portal org and store, and get a Shopify token.
import { verifyRetell } from "./crypto";
import { orgForAgent, accessTokenFor } from "./store";

export async function retellTool(req) {
  const raw = await req.text();
  if (!verifyRetell(raw, req.headers.get("x-retell-signature"), process.env.RETELL_API_KEY)) {
    return { unauthorized: true };
  }
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false }; }
  const args = body.args ?? body;
  const agentId = body.call?.agent_id;
  const callId = body.call?.call_id;
  if (!agentId) return { ok: false, args, callId };
  const org = await orgForAgent(agentId);
  const meta = org?.publicMetadata || {};
  const shop = meta.shopDomain || "";
  const token = org && shop ? await accessTokenFor(org, shop) : null;
  if (!token) return { ok: false, args, callId, shop };
  return { ok: true, args, callId, agentId, org, meta, shop, token };
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
