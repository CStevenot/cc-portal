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
| `POST /api/shopify/products` | Retell `search_products` tool | Retell signature; `read_products` |
| `POST /api/shopify/promos` | Retell `get_promotions` tool | Retell signature; only merchant-approved codes Shopify reports ACTIVE |
| `POST /api/shopify/checkout` | Retell `create_checkout_link` tool | Retell signature; `write_draft_orders`; draft order with no customer attached; returns `checkout_sms` for In-Call SMS (static sentence) |
| `POST /api/shopify/promo-settings` | embedded page | session token; merchant picks which active codes the agent may offer (`publicMetadata.agentPromoCodes`) |
| `GET /api/cron/shopify-usage` | Vercel Cron, 1st of month 09:17 UTC (`vercel.json`) | `Bearer $CRON_SECRET`; `?dry=1` computes without billing |
| `GET /privacy` | public | none |

- **Env:** see `.env.example`. `TOKEN_ENC_KEY` is different in Preview and Production.
- **Tests:** `npm test` runs 35 unit tests (incl. product query sanitizing, promo allowlist, checkout item parsing, the fixed SMS text, and the $549 plan default); earlier suite: 14 unit tests covering crypto, HMAC, the Retell signature, session JWT, lookup logic, redaction, usage metering and data-request matching.
- **Metering:** bills last calendar month's minutes over `includedMinutes` at `PLAN_OVERAGE_PER_MIN` to the subscription's usage line. It is idempotent per shop per month (Shopify idempotency key plus `lastUsageBilled` in org metadata).
- **Webhooks:** return 200 at once, then do the work in `after()`. `customers/data_request` emails the matching call records to `OPS_EMAIL` (Resend). `shop/redact` deletes call records only for orgs with `channel: "shopify"`, so a direct client that drops the app keeps its history.
- **Deploy config:** run `shopify app deploy` with `shopify.app.toml`, after filling in `client_id`.
- **Retention:** Shopify-client agents keep calls 90 days. There is no Shopify order data at rest.
- **Plan:** one Shopify plan, "Client Connected Pro": $549 / 30 days, ~500 min included, $0.65/min overage, $500 usage cap (env `PLAN_*` overrides).
- **Checkout SMS:** the agent never writes the text. `create_checkout_link` returns `checkout_sms`; Retell In-Call SMS sends `{{checkout_sms}}` as a static sentence from the agent's own number, which must be on an approved 10DLC campaign for that merchant.
