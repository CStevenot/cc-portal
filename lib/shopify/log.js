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

// Access log: one line per customer lookup, never email/phone. Keep 90 days via log drain.
export function accessLog(data) {
  log("pcd_access", { kind: "order_lookup", ...data });
}
