import { verifyRetell } from "../../../../lib/shopify/crypto";
import { sendEmail } from "../../../../lib/shopify/notify";
import { alertEmail, visitorSpoke, getChat } from "../../../../lib/chat";

// Retell chat-agent webhook. On chat_analyzed (the full chat, with summary and
// sentiment), email the transcript to CHAT_ALERT_EMAIL (falls back to OPS_EMAIL).
// Only agents whose webhook URL points here send events. Nothing is stored.
// Retell retries non-2xx up to 3 times, so anything that isn't a bad signature
// returns 200; a warm instance also skips repeats it has already sent.
export const dynamic = "force-dynamic";
const sent = new Set();

export async function POST(req) {
  const raw = await req.text();
  const key = process.env.RETELL_API_KEY;
  if (!key || !verifyRetell(raw, req.headers.get("x-retell-signature"), key)) {
    return Response.json({ error: "bad_signature" }, { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ ok: true, ignored: "bad_json" }); }
  const event = body.event;
  let chat = body.chat || body.data || null;
  if (event !== "chat_analyzed" || !chat?.chat_id) return Response.json({ ok: true, ignored: event || "none" });
  if (sent.has(chat.chat_id)) return Response.json({ ok: true, duplicate: true });

  // Payload should carry the full chat; if messages are missing, fetch them.
  if (!chat.message_with_tool_calls && !chat.transcript) {
    try { chat = (await getChat(chat.chat_id)) || chat; } catch {}
  }
  // Widget opened but the visitor never typed: no alert.
  if (!visitorSpoke(chat)) return Response.json({ ok: true, ignored: "no_visitor_messages" });

  const to = process.env.CHAT_ALERT_EMAIL || process.env.OPS_EMAIL;
  const { subject, text } = alertEmail(chat, { portalUrl: "https://portal.client-connected.com" });
  try {
    const r = await sendEmail(to, subject, text);
    if (r.sent) sent.add(chat.chat_id);
    else console.log("[chat-alert] not sent", chat.chat_id, r.reason || r.status);
    return Response.json({ ok: true, emailed: !!r.sent });
  } catch (e) {
    console.log("[chat-alert] email error", chat.chat_id, String(e));
    return Response.json({ ok: true, emailed: false });
  }
}
