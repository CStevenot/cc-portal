// Shopify merchants live in the SAME Clerk orgs as every other portal customer.
// publicMetadata:  { shopDomain, channel: "shopify", agentIds, plan, businessName, includedMinutes, billing }
// privateMetadata: { shopify: { tokenEnc, refreshEnc, expiresAt, refreshExpiresAt, scope, installedAt } | null }
import { clerkClient } from "@clerk/nextjs/server";
import { encrypt, decrypt } from "./crypto";
import { refreshOfflineToken } from "./api";

async function allOrgs() {
  const cc = await clerkClient();
  const out = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const res = await cc.organizations.getOrganizationList({ limit: 100, offset });
    const list = res.data || res || [];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

const agentIdsOf = (o) => {
  const raw = (o.publicMetadata || {}).agentIds;
  return Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
};

export async function allOrgsWithShop() {
  return (await allOrgs()).filter((o) => (o.publicMetadata || {}).shopDomain);
}

export async function orgForShop(shop) {
  return (await allOrgs()).find((o) => (o.publicMetadata || {}).shopDomain === shop) || null;
}

export async function orgForAgent(agentId) {
  return (await allOrgs()).find((o) => agentIdsOf(o).includes(agentId)) || null;
}

export { agentIdsOf };

// Existing customers (e.g. PROOF) are matched by shopDomain; new installs get a pending portal org.
export async function ensureOrgForShop(shop) {
  const found = await orgForShop(shop);
  if (found) return found;
  const cc = await clerkClient();
  return cc.organizations.createOrganization({
    name: shop.replace(".myshopify.com", ""),
    publicMetadata: { shopDomain: shop, channel: "shopify", agentIds: [], plan: "pending", businessName: shop.replace(".myshopify.com", "") },
  });
}

export async function saveToken(orgId, t) {
  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(orgId, {
    privateMetadata: {
      shopify: {
        tokenEnc: encrypt(t.accessToken),
        refreshEnc: t.refreshToken ? encrypt(t.refreshToken) : null,
        expiresAt: t.expiresAt ?? null,
        refreshExpiresAt: t.refreshExpiresAt ?? null,
        scope: t.scope,
        installedAt: new Date().toISOString(),
      },
    },
  });
}

export async function clearToken(orgId) {
  const cc = await clerkClient();
  await cc.organizations.updateOrganizationMetadata(orgId, { privateMetadata: { shopify: null } });
}

// Valid access token, refreshing within 5 minutes of expiry. null if none or unrecoverable.
export async function accessTokenFor(org, shop) {
  const cc = await clerkClient();
  const full = await cc.organizations.getOrganization({ organizationId: org.id });
  const s = (full.privateMetadata || {}).shopify;
  if (!s?.tokenEnc) return null;
  if (!s.expiresAt || Date.now() < s.expiresAt - 5 * 60 * 1000) return decrypt(s.tokenEnc);
  if (!s.refreshEnc || (s.refreshExpiresAt && Date.now() > s.refreshExpiresAt)) return null;
  const t = await refreshOfflineToken(shop, decrypt(s.refreshEnc));
  await saveToken(org.id, t);
  return t.accessToken;
}

export async function patchPublic(orgId, patch) {
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  await cc.organizations.updateOrganizationMetadata(orgId, { publicMetadata: { ...(org.publicMetadata || {}), ...patch } });
}
