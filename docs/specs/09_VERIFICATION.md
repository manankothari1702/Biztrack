# Verification Record — Inventory & Invoicing

What has actually been **observed working against the deployed stack**, as opposed to
written, typechecked or unit-tested. Append a section per phase; never edit an earlier
one, so the record stays a history rather than a snapshot.

Rule for this file: only record what was run and seen. If something was inferred, say so
and say what would prove it.

---

## Phase 2 — backend: products, batches, stock engine

**Verified:** 2026-07-22 (infrastructure, direct invocation) and 2026-07-23 (signed-in via
the dev proxy).
**Stack:** `BiztrackStack` · account `346299179287` · `ap-south-1`
**API:** `https://jklolwtrlg.execute-api.ap-south-1.amazonaws.com/prod`

### Automated tests

| Suite | Command | Result |
|-------|---------|--------|
| Frontend | `npx vitest run` | **60 passed** |
| Lambda | `cd lambda && npm test` | **149 passed** |
| Infra (CDK assertions) | `cd infra && npx jest` | **20 passed** |
| | | **229 total** |

Typecheck clean in all three projects (`tsc -b`, `tsc --noEmit`, `tsc --noEmit`).
`dist/` contains **0** `*.test.js` — tests are excluded from the Lambda asset.

### Infrastructure

| Item | Observed |
|------|----------|
| `GSI6-InventoryDate` | `IndexStatus: ACTIVE`, `Backfilling: false`, keys `PK` + `invDate`, projection `ALL` |
| Pre-existing indexes | GSI1–GSI5 unchanged; `GSI3` confirmed to be `GSI3-ClientName`, as the spec correction assumed |
| Lambda functions | 11 `biztrack-*` live, all `nodejs20.x` |
| Package size | **36.0 MB → 6.58 MB** zipped per function after `npm ci --omit=dev` (unzipped 96 MB → 31 MB) |
| Dev deps in the deployed artifact | `typescript`, `vitest`, `vite`, `@vitest`, `rollup`, `esbuild` all **absent** — checked by downloading the live package from `get-function` and listing the zip |
| Handlers in the deployed artifact | `products.js`, `batches.js`, `stockMovements.js` present with `exports.handler`, verified in the **live** zip before the routes were wired |
| Routes created | 61 resources in the 6c deploy; `cdk diff` afterwards: **0 differences** |

### End-to-end stock flow (2026-07-22, direct `lambda invoke`)

Ran against a throwaway uid, then deleted. Table returned to its original 65 items.

1. `POST /products` → **201**, product created
2. Batch seeded directly into DynamoDB (purchase invoices are Phase 3)
3. `GET /batches?expiringInDays=30` → **200**, batch found — **GSI6 range query proven**
4. `POST /batches/{id}/{expiry}/write-off` → **200**, `writtenOff: 8`
5. `GET /stock-movements` → **200**, `WRITE_OFF` movement present with `reason: "Expired — e2e probe"`
6. Batch row **retained at `quantity: 0`** (history policy), hidden from the default list
7. `earliestExpiry` **removed** from the product by the post-transaction recompute

> The product ended at `totalQuantity: -8`. That is a **seeding artifact, not a defect**:
> the batch was inserted straight into DynamoDB, bypassing `lib/stock.ts`, so the roll-up
> was never incremented; the write-off then decremented it correctly. It is a live
> demonstration of why every stock change must go through the engine.

### Signed-in through the Vite dev proxy (2026-07-23)

Closes the last hop of the option-B dev setup: that the `Authorization` header survives
the proxy and a real authorized call returns data.

**Dev user** (created for local iteration; isolated from real data because every row is
keyed `PK = USER#<uid>` from the verified token):

```
email  1702mkothari+biztrack@gmail.com
sub    61f36d3a-4091-7087-e49d-ef1bdc198e58
status CONFIRMED · enabled · email_verified
```

Created with `admin-create-user --message-action SUPPRESS` then
`admin-set-user-password --permanent`. The password lives only in the gitignored
`.env.development.local` as `DEV_USER_PASSWORD` and is **not recorded here or anywhere in
version control**. Vite exposes only `VITE_`-prefixed variables to the browser bundle, so
it never reaches client code.

All requests below went to `http://localhost:5173/api/...` — i.e. through the Vite proxy,
not directly to API Gateway:

| Request | Status | Body |
|---------|--------|------|
| `GET /api/products` | **200** | `{"products":[],"nextToken":null,"count":0}` |
| `GET /api/products?search=formula` | 200 | empty result set |
| `GET /api/products?sortBy=value&limit=5` | 200 | empty result set |
| `GET /api/products/does-not-exist` | **404** | `{"error":"NOT_FOUND","message":"Product not found","productId":"does-not-exist"}` |
| `GET /api/batches` | 200 | `{"batches":[],"nextToken":null}` |
| `GET /api/batches?expiringInDays=30` | 200 | GSI6 range query |
| `GET /api/batches?status=expired` | 200 | GSI6 range query |
| `GET /api/stock-movements` | 200 | `{"movements":[],"nextToken":null}` |
| `GET /api/stock-movements?type=WRITE_OFF` | 200 | filtered list |
| `POST /api/stock-movements` | **403** | see below — *not* the documented 405 |

**The proxy path is proven end to end.** Responses carried `x-amz-apigw-id` and
`x-amzn-requestid` (e.g. `A8lHNHf9BcwEBIw=`), so the requests demonstrably reached API
Gateway rather than being served locally, and the ID token's `sub` claim matched the dev
user, so they were authorized as that account. No CORS error at any point — the browser
stays same-origin, so no preflight is sent and the C3 allowlist is never consulted.

The `404` also confirms the **coded error shape** (`{error: CODE, message, ...context}`)
reaches the client intact, which is what the UI branches on.

### Discrepancy found: `POST /stock-movements` returns 403, not 405

`05_API_CONTRACT.md` §4 claimed unrouted verbs return `405 METHOD_NOT_ALLOWED`. They do
not. Only `GET` and `OPTIONS` are wired on that resource, so API Gateway rejects at the
routing layer before the Lambda runs:

- with an `Authorization` header → `403` · `IncompleteSignatureException`
- without one → `403 {"message":"Missing Authentication Token"}`

Standard API Gateway behaviour for any unrouted method on any endpoint, not specific to
this one. The handler's `405` + `Allow: GET` **is** correct — confirmed by invoking the
function directly — and is kept deliberately as defence-in-depth. §4 has been corrected;
see the reasoning there before touching either side.

### Not yet verified

- **Any UI.** No component has been written; Phase 3.
- **Invoices** — `invoices.ts` does not exist yet, so numbering, the `{seq, year}` yearly
  reset, idempotency via `attribute_not_exists(PK)`, and `409 INSUFFICIENT_STOCK` under a
  real concurrent sale are all unexercised.
- **Batch creation through a purchase invoice.** Batches have only ever been seeded
  directly; the `IN` path through `applyStockChange` is unit-tested but never run live.
- **Multi-line transactions with real data** — per-product roll-up aggregation and the
  30-line cap are covered by unit tests only.
- **The re-key path** (`PUT /batches/...` with a changed expiry) against live data,
  including the merge-into-existing-batch case.
- **Excel import** — `POST /products/bulk` has not been run with the 57-row seed file.
- **Reserved concurrency** — still gated off pending the account quota raise (FU-0).
