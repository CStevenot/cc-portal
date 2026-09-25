// Retell data deletion for Shopify privacy webhooks (uses the portal's RETELL_API_KEY).
const BASE = "https://api.retellai.com";
const H = () => ({ Authorization: `Bearer ${process.env.RETELL_API_KEY}`, "Content-Type": "application/json" });

// POST /v3/list-calls (current endpoint). Paginates; 90-day retention bounds the window.
export async function listCallsForAgents(agentIds) {
  if (!agentIds.length) return [];
  const out = [];
  let pagination_key;
  do {
    const body = { filter_criteria: { agent: agentIds.map((agent_id) => ({ agent_id })) }, limit: 1000, ...(pagination_key ? { pagination_key } : {}) };
    const r = await fetch(`${BASE}/v3/list-calls`, { method: "POST", headers: H(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`list-calls ${r.status}`);
    const j = await r.json();
    out.push(...(j.items || []));
    pagination_key = j.has_more ? j.pagination_key : undefined;
  } while (pagination_key);
  return out;
}

export async function deleteCall(callId) {
  const r = await fetch(`${BASE}/v2/delete-call/${encodeURIComponent(callId)}`, { method: "DELETE", headers: H() });
  if (!(r.status === 204 || r.status === 200 || r.status === 422)) throw new Error(`delete-call ${r.status}`);
}

const digits = (s = "") => s.replace(/\D/g, "").slice(-10);

export function matchesCustomer(c, emails, phones) {
  const nums = [c.from_number, c.collected_dynamic_variables?.customer_contact].map((x) => digits(x || "")).filter(Boolean);
  const stated = (c.collected_dynamic_variables?.customer_contact || "").trim().toLowerCase();
  return phones.map((p) => digits(p)).some((p) => p && nums.includes(p)) || (!!stated && emails.map((e) => e.toLowerCase()).includes(stated));
}

// Attach a lookup access record to the Retell call itself, so the access log
// lives with the call record: same 90-day retention, deleted by the same redact paths.
export async function tagCallAccess(callId, entry) {
  if (!callId) return;
  const r = await fetch(`${BASE}/v2/update-call/${encodeURIComponent(callId)}`, {
    method: "PATCH", headers: H(), body: JSON.stringify({ metadata: { pcd_access: entry } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`update-call ${r.status}`);
}
