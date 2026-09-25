// Structured logging with PII redaction (Security & Privacy Program §6).
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\(?\d[\d\s().-]{7,}\d/g;

export function redact(v) {
  if (typeof v === "string") return v.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]));
  return v;
}

export function log(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...redact(data) }));
}

// Access log: one line per customer lookup, never email/phone. Written to the runtime
// log and (by the lookup route) onto the Retell call record, which is kept 90 days.
export function accessLog(data) {
  const entry = { ts: new Date().toISOString(), kind: "order_lookup", ...redact(data) };
  log("pcd_access", entry);
  return entry;
}
