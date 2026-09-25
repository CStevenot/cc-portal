// Ops email via Resend's HTTP API (no SDK). Needs RESEND_API_KEY and OPS_EMAIL.
// Without them, the caller falls back to a log line so nothing fails silently.
export async function emailOps(subject, text) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OPS_EMAIL;
  if (!key || !to) return { sent: false, reason: "RESEND_API_KEY or OPS_EMAIL not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.OPS_FROM || "Client Connected <ops@client-connected.com>",
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return { sent: r.ok, status: r.status };
}
