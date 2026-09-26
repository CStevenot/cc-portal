// Email via Resend's HTTP API (no SDK). Needs RESEND_API_KEY plus a recipient.
// Without them, callers fall back to a log line so nothing fails silently.
export async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return { sent: false, reason: "RESEND_API_KEY or recipient not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.OPS_FROM || "Client Connected <ops@client-connected.com>",
      to: String(to).split(",").map((s) => s.trim()).filter(Boolean),
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return { sent: r.ok, status: r.status };
}

export async function emailOps(subject, text) {
  return sendEmail(process.env.OPS_EMAIL, subject, text);
}
