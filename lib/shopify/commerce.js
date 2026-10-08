// Pure helpers for the day-one sales tools: product search, merchant-approved promos,
// and draft-order checkout links. No I/O here so it is unit-testable.

export const MAX_LINES = 10;
export const MAX_QTY = 10;

// Free-text product search -> Shopify search syntax. Strips operators/quotes so a
// caller's words can't widen the query, and always limits to active products.
export function productSearchQuery(text) {
  const words = String(text || "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w && !/^(and|or|not)$/i.test(w))
    .slice(0, 6);
  if (!words.length) return null;
  return `${words.join(" ")} AND status:active`;
}

const money = (v) => {
  if (v == null || v === "") return "";
  const n = Number(v?.amount ?? v);
  return Number.isFinite(n) ? n.toFixed(2) : "";
};

// GraphQL products -> compact, voice-friendly result. Variant ids are numeric strings
// the agent passes back to create_checkout_link.
export function formatProducts(nodes = []) {
  const products = nodes.slice(0, 5).map((p) => ({
    title: p.title,
    variants: (p.variants?.nodes || []).slice(0, 8).map((v) => ({
      variant_id: String(v.id || "").split("/").pop(),
      option: v.title === "Default Title" ? "" : v.title,
      price: money(v.price),
      compare_at_price: money(v.compareAtPrice),
      available: v.availableForSale ? "true" : "false",
    })),
  }));
  const summary = products
    .map((p) => {
      const vs = p.variants
        .map((v) => `${v.option ? v.option + " " : ""}$${v.price}${v.available === "true" ? "" : " (sold out)"} [id ${v.variant_id}]`)
        .join("; ");
      return `${p.title}: ${vs}`;
    })
    .join(" | ")
    .slice(0, 1500);
  return { products_found: products.length ? "true" : "false", products_summary: summary, products };
}

// Code discount node -> view. Handles the code-discount union types.
export function discountView(node) {
  const d = node?.codeDiscount || {};
  const code = d.codes?.nodes?.[0]?.code || "";
  return {
    code,
    title: d.title || "",
    summary: d.summary || "",
    status: d.status || "",
    ends_at: d.endsAt || "",
  };
}

export const normCode = (c) => String(c || "").trim().toUpperCase();

export function approvedCodes(publicMetadata = {}) {
  const raw = publicMetadata.agentPromoCodes;
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map(normCode).filter(Boolean))].slice(0, 20);
}

export function isApproved(code, publicMetadata) {
  const c = normCode(code);
  return !!c && approvedCodes(publicMetadata).includes(c);
}

// Items arrive from the LLM as an array or a JSON string. Accept only numeric variant ids
// and bounded quantities; merge duplicates. Returns null when nothing valid remains.
export function parseItems(raw) {
  let arr = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  const merged = new Map();
  for (const it of arr) {
    const id = String(it?.variant_id ?? "").replace(/\D/g, "");
    const qty = Math.floor(Number(it?.quantity ?? 1));
    if (!id || !Number.isFinite(qty) || qty < 1) continue;
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }
  const lines = [...merged.entries()].slice(0, MAX_LINES).map(([id, quantity]) => ({
    variantId: `gid://shopify/ProductVariant/${id}`,
    quantity,
  }));
  return lines.length ? lines : null;
}

// The exact text message. The LLM never writes this; Retell sends it as a static
// sentence from a stored variable (same pattern as the 10DLC consent text).
export function checkoutSms(businessName, url) {
  const name = String(businessName || "Your order").slice(0, 40);
  return `${name}: here's the checkout link you asked for: ${url} Reply STOP to opt out.`;
}
