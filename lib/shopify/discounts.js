// Shopify code-discount reads (scope: read_discounts).
import { adminGraphql } from "./api";
import { discountView, normCode } from "./commerce";

const FIELDS = `title summary status endsAt codes(first: 1) { nodes { code } }`;
const CODE_DISCOUNT = `codeDiscount { __typename
  ... on DiscountCodeBasic { ${FIELDS} }
  ... on DiscountCodeBxgy { ${FIELDS} }
  ... on DiscountCodeFreeShipping { ${FIELDS} } }`;

// Active code discounts in the store (for the merchant's settings screen).
export async function listActiveCodeDiscounts(shop, token) {
  const data = await adminGraphql(shop, token,
    `{ codeDiscountNodes(first: 50, query: "status:active") { nodes { id ${CODE_DISCOUNT} } } }`);
  return (data?.codeDiscountNodes?.nodes || []).map(discountView).filter((d) => d.code);
}

// One code, live from Shopify. null if it doesn't exist.
export async function getCodeDiscount(shop, token, code) {
  const data = await adminGraphql(shop, token,
    `query($code: String!) { codeDiscountNodeByCode(code: $code) { id ${CODE_DISCOUNT} } }`,
    { code: normCode(code) });
  const node = data?.codeDiscountNodeByCode;
  return node ? discountView(node) : null;
}
