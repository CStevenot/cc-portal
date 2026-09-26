import { verifySessionToken, exchangeForOfflineToken } from "./api";
import { ensureOrgForShop, accessTokenFor, saveToken } from "./store";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Authenticate an embedded-app request (App Bridge session token) and ensure an offline token.
export async function authenticate(req) {
  const auth = req.headers.get("authorization") || "";
  const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!sessionToken) throw new HttpError(401, "missing session token");
  let shop;
  try { ({ shop } = await verifySessionToken(sessionToken)); }
  catch { throw new HttpError(401, "invalid session token"); }
  const org = await ensureOrgForShop(shop);
  let accessToken = await accessTokenFor(org, shop);
  if (!accessToken) {
    const t = await exchangeForOfflineToken(shop, sessionToken);
    await saveToken(org.id, t);
    accessToken = t.accessToken;
  }
  return { shop, org, accessToken };
}

export function errorResponse(e) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(JSON.stringify({ event: "shopify_error", message: e?.message }));
  return Response.json({ error: "internal" }, { status: 500 });
}
