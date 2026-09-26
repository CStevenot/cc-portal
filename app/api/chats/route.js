import { orgAgents, listChats, summaryRow } from "../../../lib/chat";

// Org-scoped list of website chats (no transcripts; those load per chat).
// Read live from Retell; nothing is stored in the portal.
export async function GET() {
  if (!process.env.RETELL_API_KEY) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });
  const o = await orgAgents();
  if (o.error) return Response.json({ error: o.error }, { status: o.status });
  try {
    const chats = await listChats(o.agentIds);
    // Belt and braces: never return a chat from an agent outside this org.
    const rows = chats.filter((c) => o.agentIds.includes(c.agent_id)).map(summaryRow);
    return Response.json({ chats: rows });
  } catch (e) {
    return Response.json({ error: "Retell API error", detail: String(e.message || e) }, { status: 502 });
  }
}
