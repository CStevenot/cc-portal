import crypto from "crypto";

// AES-256-GCM for secrets at rest (Shopify tokens). Key: 32 bytes base64 in TOKEN_ENC_KEY.
const key = () => {
  const k = Buffer.from(process.env.TOKEN_ENC_KEY || "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes base64");
  return k;
};

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Shopify webhook HMAC: base64(HMAC-SHA256(rawBody, client secret)).
export function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!hmacHeader) return false;
  const calc = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(calc, hmacHeader);
}

// Retell signature header "v={ms},d={hex}", digest = HMAC-SHA256(rawBody + ms, key), 5-minute window.
export function verifyRetell(rawBody, header, key, now = Date.now()) {
  if (!header) return false;
  const m = /v=(\d+),d=([0-9a-f]+)/.exec(header);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60 * 1000) return false;
  const calc = crypto.createHmac("sha256", key).update(rawBody + m[1]).digest("hex");
  return safeEqual(calc, m[2]);
}
