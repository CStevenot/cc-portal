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
| `GET /api/cron/shopify-usage` | Vercel Cron, 1st of month 09:17 UTC (`vercel.json`) | `Bearer $CRON_SECRET`; `?dry=1` computes without billing |
| `GET /privacy` | public | none |

- **Env:** see `.env.example`. `TOKEN_ENC_KEY` is different in Preview and Production.
- **Tests:** `npm test` runs 14 unit tests covering crypto, HMAC, the Retell signature, session JWT, lookup logic, redaction, usage metering and data-request matching.
- **Metering:** bills last calendar month's minutes over `includedMinutes` at `PLAN_OVERAGE_PER_MIN` to the subscription's usage line. It is idempotent per shop per month (Shopify idempotency key plus `lastUsageBilled` in org metadata).
- **Webhooks:** return 200 at once, then do the work in `after()`. `customers/data_request` emails the matching call records to `OPS_EMAIL` (Resend). `shop/redact` deletes call records only for orgs with `channel: "shopify"`, so a direct client that drops the app keeps its history.
- **Deploy config:** run `shopify app deploy` with `shopify.app.toml`, after filling in `client_id`.
- **Retention:** Shopify-client agents keep calls 90 days. There is no Shopify order data at rest.
