import { retellTool, unauthorized } from "../../../../lib/shopify/tool";
import { adminGraphql } from "../../../../lib/shopify/api";
import { productSearchPlan, formatProducts } from "../../../../lib/shopify/commerce";
import { log } from "../../../../lib/shopify/log";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Retell custom function `search_products`. Args: { query }. Live catalog prices and
// availability; nothing is stored. Not protected customer data.
// Runs the search plan (exact -> related -> catalog) and returns the first pass with
// results, so a conversational ask never comes back empty while the store has stock.
const EMPTY = { products_found: "false", match: "none", products_summary: "", products: [] };

const PRODUCTS = `query($q: String!, $sort: ProductSortKeys!) { products(first: 5, query: $q, sortKey: $sort) { nodes {
  title productType description(truncateAt: 160)
  variants(first: 8) { nodes { id title price compareAtPrice availableForSale } } } } }`;

export async function POST(req) {
  try {
    const t = await retellTool(req);
    if (t.unauthorized) return unauthorized();
    if (!t.ok) return Response.json({ ...EMPTY, reason: t.reason });
    for (const step of productSearchPlan(t.args.query)) {
      const sort = step.match === "catalog" ? "INVENTORY_TOTAL" : "RELEVANCE";
      const data = await adminGraphql(t.shop, t.token, PRODUCTS, { q: step.q, sort });
      const nodes = data?.products?.nodes || [];
      if (nodes.length) {
        const out = formatProducts(nodes, step.match);
        log("product_search", { shop: t.shop, callId: t.callId, match: step.match, results: out.products.length });
        return Response.json(out);
      }
    }
    log("product_search", { shop: t.shop, callId: t.callId, match: "none", results: 0 });
    return Response.json(EMPTY);
  } catch (e) {
    log("product_search_error", { message: e?.message });
    return Response.json({ ...EMPTY, reason: "error" });
  }
}
