import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { SignJWT } from "jose";
import { encrypt, decrypt, verifyShopifyWebhook, verifyRetell } from "../lib/shopify/crypto.js";
import { redact } from "../lib/shopify/log.js";
import { contactMatches, mapStatus } from "../lib/shopify/order.js";
import { matchesCustomer } from "../lib/shopify/retell.js";
import { verifySessionToken } from "../lib/shopify/api.js";

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
  process.env.SHOPIFY_CLIENT_ID = "client123";
  process.env.SHOPIFY_CLIENT_SECRET = "secret456";
});

describe("crypto", () => {
  it("round-trips AES-GCM and rejects tampering", () => {
    const b = encrypt("shpat_abc");
    expect(decrypt(b)).toBe("shpat_abc");
    const parts = b.split(".");
    parts[2] = Buffer.from("x").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("verifies Shopify webhook HMAC", () => {
    const body = '{"a":1}';
    const h = crypto.createHmac("sha256", "secret456").update(body).digest("base64");
    expect(verifyShopifyWebhook(body, h, "secret456")).toBe(true);
    expect(verifyShopifyWebhook(body + " ", h, "secret456")).toBe(false);
    expect(verifyShopifyWebhook(body, null, "secret456")).toBe(false);
  });
  it("verifies Retell signature with 5-minute window", () => {
    const body = '{"args":{}}'; const ts = String(Date.now());
    const d = crypto.createHmac("sha256", "rk").update(body + ts).digest("hex");
    expect(verifyRetell(body, `v=${ts},d=${d}`, "rk")).toBe(true);
    expect(verifyRetell(body, `v=${ts},d=${d}`, "wrong")).toBe(false);
    expect(verifyRetell(body, `v=${ts},d=${d}`, "rk", Date.now() + 6 * 60 * 1000)).toBe(false);
  });
});

describe("session token", () => {
  const sign = (claims, secret = "secret456") =>
    new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1m").sign(new TextEncoder().encode(secret));
  it("accepts a valid token and extracts the shop", async () => {
    const t = await sign({ iss: "https://shop1.myshopify.com/admin", dest: "https://shop1.myshopify.com", aud: "client123", sub: "1" });
    expect((await verifySessionToken(t)).shop).toBe("shop1.myshopify.com");
  });
  it("rejects wrong secret, wrong audience, bad dest", async () => {
    await expect(verifySessionToken(await sign({ iss: "https://s.myshopify.com/admin", dest: "https://s.myshopify.com", aud: "client123" }, "nope"))).rejects.toThrow();
    await expect(verifySessionToken(await sign({ iss: "https://s.myshopify.com/admin", dest: "https://s.myshopify.com", aud: "other" }))).rejects.toThrow();
    await expect(verifySessionToken(await sign({ iss: "https://evil.com/admin", dest: "https://evil.com", aud: "client123" }))).rejects.toThrow();
  });
});

describe("lookup logic", () => {
  it("matches contact by email (case-insensitive) or last-10 phone digits", () => {
    expect(contactMatches("Jo@X.com", "jo@x.com", null)).toBe(true);
    expect(contactMatches("jo@y.com", "jo@x.com", null)).toBe(false);
    expect(contactMatches("(614) 555-0148", null, "+16145550148")).toBe(true);
    expect(contactMatches("555-0148", null, "+16145550148")).toBe(false);
    expect(contactMatches("", "a@b.com", "+16145550148")).toBe(false);
  });
  it("maps fulfillment status", () => {
    expect(mapStatus({ displayFulfillmentStatus: "UNFULFILLED", fulfillments: [] })).toBe("not_shipped");
    expect(mapStatus({ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "IN_TRANSIT" }] })).toBe("in_transit");
    expect(mapStatus({ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "DELIVERED" }] })).toBe("delivered");
    expect(mapStatus({})).toBe("unknown");
  });
  it("matches Retell calls to a customer for redaction", () => {
    const c = { call_id: "1", from_number: "+16145550148", collected_dynamic_variables: { customer_contact: "Jo@X.com" } };
    expect(matchesCustomer(c, [], ["614-555-0148"])).toBe(true);
    expect(matchesCustomer(c, ["jo@x.com"], [])).toBe(true);
    expect(matchesCustomer(c, ["no@x.com"], ["2125550000"])).toBe(false);
  });
});

describe("log redaction", () => {
  it("strips emails and phone numbers", () => {
    expect(redact({ a: "call jo@x.com or (614) 555-0148", n: 5 })).toEqual({ a: "call [email] or [phone]", n: 5 });
  });
});
