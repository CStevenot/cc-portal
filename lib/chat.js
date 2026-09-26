// Website chat helpers: Retell reads, org scoping, and pure formatters
// shared by the Chats API, the dashboard tab and the alert email.
import { auth, clerkClient } from "@clerk/nextjs/server";

// Signed-in user's active org and its Retell agentIds. Fails closed: no agents = nothing visible.
export async function orgAgents() {
  const { userId, orgId } = await auth();
  if (!userId) return { error: "unauthorized", status: 401 };
  if (!orgId) return { error: "no_org", status: 403 };
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  const raw = (org.publicMetadata || {}).agentIds;
  const agentIds = Array.isArray(raw)
    ? raw
    : typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!agentIds.length) return { error: "no_agents", status: 403 };
  return { agentIds, org };
}

// Retell chat reads. Current endpoints per the 06/15/2026 deprecation notice:
// POST /v3/list-chats (no transcripts) and GET /get-chat/{chat_id} (full chat).
const BASE = "https://api.retellai.com";
const H = () => ({ Authorization: `Bearer ${process.env.RETELL_API_KEY}`, "Content-Type": "application/json" });

export async function listChats(agentIds, limit = 200) {
  if (!agentIds.length) return [];
  const r = await fetch(`${BASE}/v3/list-chats`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({
      filter_criteria: { agent: agentIds.map((agent_id) => ({ agent_id })) },
      sort_order: "descending",
      limit,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`list-chats ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : j.items || [];
}

export async function getChat(chatId) {
  const r = await fetch(`${BASE}/get-chat/${encodeURIComponent(chatId)}`, {
    headers: H(),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`get-chat ${r.status}`);
  return r.json();
}

// Pure helpers shared by the Chats API, the dashboard tab and the alert email.

// Lead details: post-chat extraction fields plus anything the agent collected.
// Retell's own preset keys are shown separately, so they're skipped here.
const SKIP = new Set(["chat_summary", "chat_successful", "user_sentiment"]);
export function leadFields(chat) {
  const out = {};
  const add = (obj) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (SKIP.has(k) || v === null || v === undefined || v === "") continue;
      if (typeof v === "object") continue;
      out[k] = String(v);
    }
  };
  add(chat?.collected_dynamic_variables);
  add(chat?.chat_analysis?.custom_analysis_data);
  return out;
}

export const labelOf = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Messages from the visitor and the agent only (tool calls and transitions dropped).
export function dialogue(chat) {
  const msgs = Array.isArray(chat?.message_with_tool_calls) ? chat.message_with_tool_calls : [];
  const d = msgs
    .filter((m) => (m.role === "user" || m.role === "agent") && m.content)
    .map((m) => ({ role: m.role, text: String(m.content), ts: m.created_timestamp || null }));
  if (d.length || !chat?.transcript) return d;
  // Fallback: parse the plain transcript ("Agent: ...\nUser: ...").
  return String(chat.transcript)
    .split("\n")
    .map((line) => /^(Agent|User):\s?(.*)$/i.exec(line))
    .filter(Boolean)
    .map((m) => ({ role: m[1].toLowerCase(), text: m[2], ts: null }));
}

export const visitorSpoke = (chat) => dialogue(chat).some((m) => m.role === "user");

export function summaryRow(chat) {
  const a = chat?.chat_analysis || {};
  return {
    chatId: chat.chat_id,
    agentId: chat.agent_id,
    status: chat.chat_status,
    ts: chat.start_timestamp || 0,
    endTs: chat.end_timestamp || null,
    summary: a.chat_summary || "",
    sentiment: a.user_sentiment || "",
    successful: typeof a.chat_successful === "boolean" ? a.chat_successful : null,
    lead: leadFields(chat),
  };
}

export function alertEmail(chat, { portalUrl } = {}) {
  const row = summaryRow(chat);
  const lead = row.lead;
  const who = lead.name || lead.caller_name || lead.first_name || lead.email || lead.phone || "Website visitor";
  const when = row.ts ? new Date(row.ts).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "";
  const lines = [
    `New website chat: ${who}`,
    when && `Started: ${when}`,
    row.sentiment && `Sentiment: ${row.sentiment}`,
    row.successful !== null && `Successful: ${row.successful ? "Yes" : "No"}`,
    "",
    "SUMMARY",
    row.summary || "(no summary)",
  ].filter((x) => x !== false && x !== undefined);
  const keys = Object.keys(lead);
  if (keys.length) {
    lines.push("", "LEAD DETAILS");
    for (const k of keys) lines.push(`${labelOf(k)}: ${lead[k]}`);
  }
  lines.push("", "TRANSCRIPT");
  for (const m of dialogue(chat)) lines.push(`${m.role === "user" ? "Visitor" : "Agent"}: ${m.text}`);
  lines.push("", `Chat ID: ${chat.chat_id}`);
  if (portalUrl) lines.push(`Portal: ${portalUrl}`);
  const subject = `New chat: ${who}${row.sentiment ? ` (${row.sentiment})` : ""}`;
  return { subject, text: lines.join("\n") };
}
