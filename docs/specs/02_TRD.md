# TRD — Biztrack Inventory & Invoicing

**Companion to:** `01_PRD.md`. Detailed specs live in `INVENTORY_FEATURE_BLUEPRINT.md`
and `INVOICE_FEATURE_BLUEPRINT.md` at the repo root.
**Last updated:** 2026-07-19
**Corrections applied 2026-07-22:** resolves C1 (index renamed `GSI6-InventoryDate`),
C2 (`biztrack-stack.ts` is live IaC in this repo — stub note and no-GSI fallback removed),
C4 (error shape), C6/D3 (Vitest in `lambda/`), D2 (print-to-PDF settled), D5 (WhatsApp only).

---

## 1. Guiding principle

This feature **extends the existing Biztrack app** and must reuse its patterns. Nothing
new is invented at the infrastructure level — Inventory/Invoicing sit alongside Clients
and Tasks and copy their handler, service, and hook structure.

## 2. Tech stack (existing, unchanged)

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript, Vite 7, React Router 7 |
| Styling | Tailwind CSS 4 (`@theme` tokens in `src/index.css`) |
| Icons | FontAwesome (already installed) |
| Auth | AWS Cognito via `aws-amplify` (ID token in `Authorization` header) |
| API | Amazon API Gateway (REST) → AWS Lambda (Node/TypeScript) |
| Data | Amazon DynamoDB — single table `biztrack`, single-table design |
| Spreadsheet | `exceljs` (import/export) — already a dependency |
| Dates | `date-fns` — already a dependency |
| Tests | Vitest (frontend **and** `lambda/`), Jest (infra) |
| Infra | AWS CDK — `infra/lib/biztrack-stack.ts` (the live stack; see §6) |

**No new client libraries.** PDF is browser print-to-PDF (`window.print()` + a print
stylesheet) — decided, not optional. `jspdf` is explicitly **not** a dependency.

> **Test tooling (D3):** Vitest is already configured for the frontend
> (`vite.config.ts`, `environment: 'node'`), but `src/` currently contains **zero** test
> files and `lambda/` has **no test runner at all**. Phase 1 adds the first frontend
> tests; Phase 2 adds Vitest to `lambda/` and tests `lib/stock.ts` transaction-item
> construction as a pure function. Component tests would additionally need `jsdom` +
> `@testing-library/react` (neither installed) — out of scope for v1.

## 3. Architecture style

- **Serverless, service-per-entity Lambdas** behind API Gateway (not a monolith server,
  not microservices with their own datastores). Each entity (`products`, `invoices`,
  `stockMovements`) is one Lambda routed by method + path, mirroring `lambda/src/tasks.ts`.
- **Single-table DynamoDB.** `PK = USER#<uid>`, `SK = <ENTITY>#...`. All of a user's data
  shares a partition; entities are distinguished by SK prefix. Per-user data isolation is
  enforced by deriving `uid` from the verified Cognito token on every request.
- **Client → API → Lambda → DynamoDB.** Frontend talks only to the typed `apiService.ts`
  layer; React feature hooks (`useInventory`, `useInvoices`) own state and optimistic updates.

```
React (features/inventory, features/invoices)
        │  apiService.ts (fetch + Cognito token)
        ▼
API Gateway (REST)
        │
        ▼
Lambda handlers: products.ts · batches.ts · invoices.ts · stockMovements.ts · dashboard.ts
        │  @aws-sdk/lib-dynamodb (DocumentClient)
        ▼
DynamoDB single table "biztrack" (+ GSI6-InventoryDate)
```

## 4. Third-party services / APIs

- **AWS Cognito** — authentication (existing user pool).
- **AWS API Gateway + Lambda + DynamoDB** — existing serverless backend.
- **WhatsApp daily report** — existing `whatsappScheduler.ts` (Meta Graph API);
  extended with an inventory-alerts section. No new provider.
- **No external inventory/payment/tax APIs** in v1.

> **No email report exists (D5).** Earlier drafts of this pack said "WhatsApp / email
> daily report". The repo has only the WhatsApp pipeline — no SES client, no
> `@aws-sdk/client-ses`, no mail transport anywhere. Email alerts would be a **new
> provider** and are out of scope for v1.

## 5. Key backend components (new)

| File | Responsibility |
|------|----------------|
| `lambda/src/products.ts` | Product catalogue CRUD, list with cached roll-ups, bulk import/export |
| `lambda/src/batches.ts` | Expiry range queries, manual correction, write-off |
| `lambda/src/invoices.ts` | Sale + Purchase CRUD, atomic numbering, total recompute, stock application |
| `lambda/src/stockMovements.ts` | **Read-only** movement log (audit). No `POST` — movements are written only as a side effect of invoice finalization and batch corrections |
| `lambda/src/lib/db.ts` | + key helpers: `product`, `batch`, `stockMove`, `invoice`, `counter` |
| `lambda/src/lib/stock.ts` | **New.** Shared `applyStockChange()` — builds the `TransactWrite` items for the batch delta + product roll-up + the movement record. **All movement writes live here**, not in `stockMovements.ts` |
| `lambda/src/lib/response.ts` | + `conflict(code, message, extra)` and a code-carrying `badRequest` (see §7 Observability and `05_API_CONTRACT`) |

**Critical invariants (server-enforced):**
- Prices/totals are **recomputed server-side** from the catalogue + tier; client values are never trusted.
- Stock changes are **atomic** (`TransactWriteCommand`): invoice + batch updates + movement land together or not at all.
- **No oversell — enforced by conditional writes, not read-then-check:** every SALE batch
  decrement carries `ConditionExpression: quantity >= :q`. A concurrent sale that would
  overdraw fails the condition → the whole transaction cancels → API returns
  `409 INSUFFICIENT_STOCK`. Never rely on a prior read for this check.
- **Invoice numbers** come from an atomic per-user, per-type counter (`ADD seq :1`).
  The counter is incremented **before** the transaction; if the transaction then fails,
  that number is skipped. **Gaps in the sequence are acceptable by design** (standard
  practice; do not try to reuse numbers).
- **Yearly reset (D6):** the counter item stores `{ seq, year }`. When the current year
  differs from the stored `year`, the counter is reset to 1 for that year in the same
  conditional update — so numbering is `INV-<year>-0001` onward each January.

**Transaction size limit (hard constraint):** DynamoDB `TransactWriteCommand` accepts at
most **100 items**. Finalizing an invoice writes ≈ `1 (invoice) + lines × 2 (batch +
movement) + distinct products × 1 (roll-up)` ≈ `1 + 3 × lines`. Therefore **invoices are
capped at 30 lines** (validated server-side with a clear `400`; UI blocks adding line 31).

**Idempotency:** the client generates the invoice `id` (uuid) before saving. The invoice
put inside the transaction uses `ConditionExpression: attribute_not_exists(PK)` keyed on
that id — a retried/duplicated `POST` becomes a no-op `409 DUPLICATE` instead of
double-deducting stock. The UI treats `DUPLICATE` on retry as success (fetch and show).
This **requires the invoice SK to be derivable from the client-supplied id alone**, which
is why the key is `INVOICE#<id>` and chronological ordering comes from `GSI6` instead of
from the sort key (see §6 and Data Model §4).

**`earliestExpiry` maintenance:** transactions cannot contain queries, so:
- **PURCHASE:** new value = `min(current earliestExpiry, line expiry)` — computable inline,
  updated in the same transaction.
- **SALE / write-off that empties a batch:** the minimum may move *later*; recompute
  **after** the transaction (query the product's batches, update the cached field).
  A briefly-stale `earliestExpiry` is acceptable — it only drives badges/alerts, and
  staleness is always in the "warns too early" (safe) direction.

## 6. Data storage & indexing

- Single table `biztrack`. New SK prefixes: `PRODUCT#<id>`, `BATCH#<productId>#<expiry>`,
  `STOCKMOVE#<createdAt>#<id>`, `INVOICE#<id>`, `COUNTER#SALE`, `COUNTER#PURCHASE`.
- **New index `GSI6-InventoryDate`** — partition key `PK`, sort key `invDate`,
  `ProjectionType.ALL`. One sparse index serving two needs:
  - **Batches** write `invDate = expiryDate` → expiry range queries
    (`invDate BETWEEN today AND today+N`, filtered with `begins_with(SK, 'BATCH#')`).
  - **Invoices** write `invDate = createdAt` → newest-first listing
    (`ScanIndexForward: false`, filtered with `begins_with(SK, 'INVOICE#')`).

  Only items carrying `invDate` appear in the index, so products, movements and counters
  stay out of it. See Data Model §3, §4 and §7.

### Why `GSI6` and not `GSI3`

`GSI3` is **already taken**. The live table carries five indexes today
(`infra/lib/biztrack-stack.ts`):

| Index | Partition | Sort | Used by |
|-------|-----------|------|---------|
| `GSI1-FollowUpDate` | `PK` | `nextFollowUpDate` | clients due list, dashboard |
| `GSI2-TaskStatus` | `PK` | `dueDate` | task list, calendar |
| `GSI3-ClientName` | `PK` | `clientNameLower` | client name search |
| `GSI4-MobileDigits` | `PK` | `mobileDigits` | client phone search |
| `GSI5-ReportSchedule` | `reportSchedulePK` | `reportScheduleSK` | WhatsApp scheduler |

The attribute shape follows the same house style: every **per-user** index is keyed on
`PK` plus a **real attribute name**, relying on sparseness plus an `SK` prefix filter.
Synthetic `GSI<n>PK` / `GSI<n>SK` attributes (as earlier drafts of this doc proposed) are
used only by `GSI5`, and only because it is not partitioned by user.

### Infra ownership

`infra/lib/biztrack-stack.ts` **is the live stack** — `infra/bin/infra.ts` instantiates
`BiztrackStack`, which defines the table, all GSIs, every Lambda, the full API Gateway
route tree, Cognito, EventBridge, S3 and CloudFront. `infra/lib/infra-stack.ts` is unused
`cdk init` scaffold.

Therefore the index, the new Lambdas and every new route are **ordinary code changes in
this repo**, applied with `cdk deploy`. There is no out-of-repo provisioning step and no
need for an in-Lambda expiry-filter fallback. One constraint does apply: CloudFormation
allows **one GSI addition per stack update**, so ship `GSI6-InventoryDate` on its own
deploy before the handlers that query it.

## 7. Non-functional requirements

**Performance**
- Inventory page first paint from one `products` list call (cached roll-ups avoid N batch queries).
- Expiry/low-stock counts served from the existing single `dashboard` round-trip.
- Target: list/read endpoints < 300 ms P50 at expected data sizes (tens–hundreds of items).

**Security**
- All endpoints require a valid Cognito ID token; `uid` derived server-side (never from the body).
- Per-user isolation via `PK = USER#<uid>`; a user can never address another user's keys.
- Reuse `guardAccount(uid)` (blocks pending-deletion accounts) and CORS handling from existing handlers.
- Input sanitized via existing `lib/sanitize.ts`; table keys stripped from responses.
- Customer PII (name/phone) stored only on invoices, same protection as Client records.

**Reliability / consistency**
- Atomic `TransactWrite` for any stock-affecting operation; reject-whole-invoice on any line failure.
- Snapshots on invoice lines (name, unitPrice, unitVp, expiry) so historical documents are immutable.
- Cancel reverses stock (sale → add back; purchase → remove).

**Scalability**
- Single-table design scales per-user; volumes are small (one associate). Pagination via
  `nextToken` (base64 `LastEvaluatedKey`) on all list endpoints, matching Clients/Tasks.

**Accessibility / UX (per design system)**
- WCAG AA contrast; visible focus states; hover transitions 150–300 ms; `prefers-reduced-motion` respected.
- Responsive at 375 / 768 / 1024 / 1440 px.

**Data conventions**
- **Expiry dates are date-only** (`YYYY-MM-DD`, no time, no timezone). Comparisons use
  string comparison (ISO dates sort lexicographically). "Expired" = `expiryDate <
  today-in-user's-timezone` (reuse `User.timezone`, default `Asia/Kolkata`).
- **Money:** whole rupees (the price list has no paise), stored as integers. Display with
  Indian digit grouping (`toLocaleString('en-IN')`).
- **VP:** 2 decimal places. Sum lines first, round the total once (`Math.round(x*100)/100`)
  — never round per line then sum.

**Observability**
- Lambda logging is plain `console.log` / `console.error` (there is no `logger` module in
  `lambda/src/lib/` — `src/shared/utils/logger.ts` is frontend-only). Structured JSON log
  lines follow `lib/accountGuard.ts`.
- **Error responses (C4):** every new endpoint returns `{ error: CODE, message }` via
  `lib/response.ts`. Two helpers must be **added**: `conflict(code, message, extra)` and a
  code-carrying `badRequest`. Today `badRequest`/`notFound` put the human sentence in the
  `error` field, and there is no 409 helper at all — the frontend `ApiError` reads
  `body.error` as the code, so codes are mandatory for the UI to branch on
  `INSUFFICIENT_STOCK`. There is no typed `ApiError` on the Lambda side; `ApiError` is a
  frontend class in `apiService.ts`. Existing clients/tasks endpoints keep their current
  shape — see `05_API_CONTRACT` §0.

## 8. Deployment

- Frontend: existing Vite build + existing hosting (as today). New routes are client-side only.
- Backend: `cdk deploy` from `infra/`. New Lambdas, API Gateway routes and the
  `GSI6-InventoryDate` index are all declared in `infra/lib/biztrack-stack.ts`.
  Ship the index on its own deploy first (one GSI per stack update).
- Also update in that file: per-function reserved-concurrency entries (the `rc()` plan
  comment) and per-method throttles for the heavy new routes (`/products/bulk`,
  `POST /invoices`), alongside the existing `/clients/bulk` entries.
- Rollout: seed catalogue (Excel import) → enable Inventory read UI → enable Invoicing →
  enable alerts. Each phase independently testable (see PRD/blueprints phase plans).

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| GSI add blocks other index changes | Only one new index (`GSI6`); ship it on its own `cdk deploy` (§6) |
| `/dashboard` already a 6-query aggregate throttled to 5 rps | Inventory counts add up to 3 more queries; cache stock valuation on the profile item the way `clientCount` is cached, rather than reading every product per call |
| Quantity drift | All stock changes atomic + conditional; batches are source of truth |
| Concurrent sales oversell a batch | `ConditionExpression quantity >= :q` in the transaction (§5) |
| Double-submit deducts twice | Client-generated invoice id + `attribute_not_exists` condition (§5) |
| Invoice too large for transaction | 30-line cap, validated server-side (§5) |
| Stale `earliestExpiry` after sale | Post-transaction recompute; staleness is safe-direction only (§5) |
| Stale prices on old invoices | Snapshot prices per line at save time |
| Cost leak on customer bill | Print layout explicitly excludes cost/profit; server omits from printable payload |
