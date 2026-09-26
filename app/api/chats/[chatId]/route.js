import { orgAgents, getChat, summaryRow, dialogue } from "../../../../lib/chat";

// One chat's transcript, only if it belongs to one of the org's agents.
export async function GET(_req, { params }) {
  if (!process.env.RETELL_API_KEY) return Response.json({ error: "RETELL_API_KEY not set" }, { status: 500 });
  const o = await orgAgents();
  if (o.error) return Response.json({ error: o.error }, { status: o.status });
  const { chatId } = await params;
  try {
    const chat = await getChat(chatId);
    if (!chat || !o.agentIds.includes(chat.agent_id)) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ...summaryRow(chat), messages: dialogue(chat) });
  } catch (e) {
    return Response.json({ error: "Retell API error" }, { status: 502 });
  }
}
