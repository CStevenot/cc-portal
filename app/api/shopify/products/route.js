import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { adminGraphql } from "../../../../lib/shopify/api";
import { productSearchQuery, formatProducts } from "../../../../lib/shopify/commerce";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `search_products`. Args: { query }. Live catalog prices and
// availability; nothing is stored. Not protected customer data.
const EMPTY = { products_found: "false", products_summary: "", products: [] };

export async function POST(req) {
  try {
    const t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json(EMPTY);
    const q = productSearchQuery(t.args.query);
    if (!q) return Response.json(EMPTY);
    const data = await adminGraphql(t.shop, t.token, `query($q: String!) { products(first: 5, query: $q, sortKey: RELEVANCE) { nodes {
      title variants(first: 8) { nodes { id title price compareAtPrice availableForSale } } } } }`, { q });
    const out = formatProducts(data?.products?.nodes || []);
    log("product_search", { shop: t.shop, callId: t.callId, results: out.products.length });
    return Response.json(out);
  } catch (e) {
    log("product_search_error", { message: e?.message });
    return Response.json(EMPTY);
  }
}
