# cc-portal

## Shopify app (public app 427955388417)
Every merchant is a Clerk org in this portal, the same as the direct clients. `publicMetadata.shopDomain` links the org to its store. The encrypted offline token lives in `privateMetadata.shopify`.

| Route | Caller | Auth |
|---|---|---|
| `GET /shopify` | Shopify admin iframe (App Bridge) | none; the page itself holds no data |
| `POST /api/shopify/session` | embedded page | Shopify session token (HS256, client secret) |
| `POST /api/shopify/billing` | embedded page | session token → `appSubscriptionCreate` |
| `POST /api/shopify/webhooks` | Shopify | HMAC; 401 on a bad signature |
| `POST /api/shopify/lookup` | Retell `lookup_order` tool | `x-retell-signature` (v=ts,d=hex) |

- **Env:** see `.env.example`. `TOKEN_ENC_KEY` is different in Preview and Production.
- **Tests:** `npm test` runs 9 unit tests covering crypto, HMAC, the Retell signature, session JWT, lookup logic and redaction.
- **Deploy config:** run `shopify app deploy` with `shopify.app.toml`, after filling in `client_id`.
- **Retention:** Shopify-client agents keep calls 90 days. There is no Shopify order data at rest.
