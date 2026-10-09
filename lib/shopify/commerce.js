// Pure helpers for the day-one sales tools: product search, merchant-approved promos,
// and draft-order checkout links. No I/O here so it is unit-testable.

export const MAX_LINES = 10;
export const MAX_QTY = 10;

// Free-text product search -> Shopify search syntax. Strips operators/quotes so a
// caller's words can't widen the query, and always limits to active products.
function cleanWords(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w && !/^(and|or|not)$/i.test(w))
    .slice(0, 6);
}

export function productSearchQuery(text) {
  const words = cleanWords(text);
  if (!words.length) return null;
  return `${words.join(" ")} AND status:active`;
}

// Words callers use that never name a product. Dropped from the broad pass.
const FILLER = new Set(("a an the for me my i im i'm you your to of in on with that this is are be good great best " +
  "nice some any anything something need needs want wants looking look recommend recommendation suggest one ones get " +
  "just really can could do does have has what which who it its kind type sort beginner beginners new first quality " +
  "cheap affordable starter all around everything stuff item items product products").split(" "));

// Ordered search passes. Shopify ANDs bare words, so a conversational phrase like
// "beginner all-mountain board" matches nothing. The plan widens step by step:
//   exact   - every word (precise asks: "black bifold wallet")
//   related - any meaningful word, prefix-matched, plurals folded ("boards" -> board*)
//   catalog - the active catalog, so the agent can always recommend something real
export function productSearchPlan(text) {
  const words = cleanWords(text);
  const plan = [];
  if (words.length) plan.push({ match: "exact", q: `${words.join(" ")} AND status:active` });
  const terms = [...new Set(words
    .flatMap((w) => w.split("-"))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w))
    .map((w) => (w.length >= 3 ? `${w}*` : w)))];
  const exactSame = words.length === 1 && terms.length === 1 && terms[0] === words[0].toLowerCase();
  if (terms.length && !exactSame) plan.push({ match: "related", q: `(${terms.join(" OR ")}) AND status:active` });
  plan.push({ match: "catalog", q: "status:active" });
  return plan;
}

const money = (v) => {
  if (v == null || v === "") return "";
  const n = Number(v?.amount ?? v);
  return Number.isFinite(n) ? n.toFixed(2) : "";
};

// GraphQL products -> compact, voice-friendly result. Variant ids are numeric strings
// the agent passes back to create_checkout_link. `match` says how the results were found
// so the agent knows whether they answer the exact ask or are the closest available.
const clip = (t, n) => {
  const x = String(t || "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x;
};

export function formatProducts(nodes = [], match = "exact") {
  const products = nodes.slice(0, 5).map((p) => ({
    title: p.title,
    type: p.productType || "",
    about: clip(p.description, 140),
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
      const head = `${p.title}${p.type ? ` (${p.type})` : ""}${p.about ? ` - ${p.about}` : ""}`;
      return `${head}: ${vs}`;
    })
    .join(" | ")
    .slice(0, 1800);
  return {
    products_found: products.length ? "true" : "false",
    match: products.length ? match : "none",
    products_summary: summary,
    products,
  };
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
    kind: d.__typename === "DiscountCodeFreeShipping" ? "shipping" : d.__typename === "DiscountCodeBxgy" ? "bxgy" : "basic",
  };
}

// What the agent may say about a promo: plain words, never the code. Codes are applied
// to the checkout link automatically, so the caller never has to hear or type one.
export function promoLabel(p) {
  const base = clip(p?.summary || p?.title || "", 160);
  const ends = p?.ends_at ? ` (ends ${String(p.ends_at).slice(0, 10)})` : "";
  return base ? `${base}${ends}` : "";
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

// Spoken-friendly order confirmation from a draft order the agent created on this call.
// Only order number, items and totals: nothing that identifies the buyer.
export function checkoutStatusView(draft, callId) {
  if (!draft) return { checkout_status: "not_found" };
  const tags = (draft.tags || []).map((t) => String(t).toLowerCase());
  if (!tags.includes("client-connected-agent")) return { checkout_status: "not_found" };
  if (callId && !String(draft.note2 || "").includes(callId)) return { checkout_status: "not_found" };
  const o = draft.order;
  if (draft.status !== "COMPLETED" || !o) {
    return { checkout_status: "pending", order_number: "", order_total: "", items_summary: "", payment_status: "" };
  }
  const items = (o.lineItems?.nodes || [])
    .map((l) => `${l.quantity} x ${l.title}${l.variantTitle && l.variantTitle !== "Default Title" ? ` (${l.variantTitle})` : ""}`)
    .join(", ")
    .slice(0, 400);
  const total = money(o.totalPriceSet?.shopMoney?.amount);
  const disc = Number(o.totalDiscountsSet?.shopMoney?.amount);
  return {
    checkout_status: "completed",
    order_number: String(o.name || "").replace(/^#/, ""),
    order_total: total,
    discount_total: Number.isFinite(disc) && disc > 0 ? disc.toFixed(2) : "",
    items_summary: items,
    payment_status: String(o.displayFinancialStatus || "").toLowerCase(),
  };
}
