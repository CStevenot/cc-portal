import { describe, it, expect, beforeAll, vi } from "vitest";
import crypto from "crypto";
import { leadFields, dialogue, visitorSpoke, summaryRow, alertEmail } from "../lib/chat.js";
import { POST } from "../app/api/webhooks/retell-chat/route.js";

const chat = {
  chat_id: "chat_1", agent_id: "agent_x", chat_status: "ended", start_timestamp: 1790000000000,
  collected_dynamic_variables: { name: "Pat Lee", email: "pat@example.com", empty: "" },
  chat_analysis: { chat_summary: "Asked about Pro.", user_sentiment: "Positive", chat_successful: true,
    custom_analysis_data: { business_type: "HVAC", chat_summary: "dup", nested: { a: 1 } } },
  message_with_tool_calls: [
    { role: "agent", content: "Hi, how can I help?" },
    { role: "tool_call_invocation", name: "x", arguments: "{}" },
    { role: "user", content: "How much is Pro?" },
  ],
};

describe("chat format", () => {
  it("collects lead fields and skips presets, empties and objects", () => {
    expect(leadFields(chat)).toEqual({ name: "Pat Lee", email: "pat@example.com", business_type: "HVAC" });
  });
  it("keeps only agent/user messages", () => {
    expect(dialogue(chat).map((m) => m.role)).toEqual(["agent", "user"]);
    expect(visitorSpoke(chat)).toBe(true);
  });
  it("falls back to the plain transcript", () => {
    const d = dialogue({ transcript: "Agent: Hi\nUser: Hello" });
    expect(d).toEqual([{ role: "agent", text: "Hi", ts: null }, { role: "user", text: "Hello", ts: null }]);
    expect(visitorSpoke({ transcript: "Agent: Hi" })).toBe(false);
  });
  it("builds a summary row and alert email", () => {
    const r = summaryRow(chat);
    expect(r.sentiment).toBe("Positive");
    expect(r.successful).toBe(true);
    const e = alertEmail(chat, { portalUrl: "https://portal.example" });
    expect(e.subject).toBe("New chat: Pat Lee (Positive)");
    expect(e.text).toContain("Visitor: How much is Pro?");
    expect(e.text).toContain("Business Type: HVAC");
    expect(e.text).toContain("Asked about Pro.");
  });
});


const KEY = "key_test";
const sign = (raw, ts = Date.now()) => `v=${ts},d=${crypto.createHmac("sha256", KEY).update(raw + ts).digest("hex")}`;
const req = (obj, sig) => {
  const raw = JSON.stringify(obj);
  return new Request("http://x/api/webhooks/retell-chat", { method: "POST", body: raw, headers: { "x-retell-signature": sig ?? sign(raw) } });
};
const wchat = { chat_id: "c1", agent_id: "a", chat_status: "ended", chat_analysis: { chat_summary: "s" },
  message_with_tool_calls: [{ role: "user", content: "hi" }] };

beforeAll(() => { process.env.RETELL_API_KEY = KEY; process.env.RESEND_API_KEY = "re_x"; process.env.CHAT_ALERT_EMAIL = "sales@example.com"; });

describe("retell chat webhook", () => {
  it("rejects bad signatures", async () => {
    expect((await POST(req({ event: "chat_analyzed", chat: wchat }, "v=1,d=00"))).status).toBe(401);
  });
  it("ignores other events and silent chats", async () => {
    expect(await (await POST(req({ event: "chat_ended", chat: wchat }))).json()).toMatchObject({ ignored: "chat_ended" });
    const silent = { ...wchat, chat_id: "c2", message_with_tool_calls: [{ role: "agent", content: "hello" }] };
    expect(await (await POST(req({ event: "chat_analyzed", chat: silent }))).json()).toMatchObject({ ignored: "no_visitor_messages" });
  });
  it("emails once per chat", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await (await POST(req({ event: "chat_analyzed", chat: wchat }))).json()).toMatchObject({ emailed: true });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.to).toEqual(["sales@example.com"]);
    expect(body.text).toContain("Visitor: hi");
    expect(await (await POST(req({ event: "chat_analyzed", chat: wchat }))).json()).toMatchObject({ duplicate: true });
    expect(f).toHaveBeenCalledTimes(1);
    f.mockRestore();
  });
});
