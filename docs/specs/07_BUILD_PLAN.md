# Build Plan — Biztrack Inventory & Invoicing

Companion to `00_README` through `06_UI_REFERENCE` and the two root blueprints.
This doc is the **file-level execution list**: every file to create or modify, in build
order, each with the existing file it mirrors. No code is written yet.

**Written:** 2026-07-22 · **Basis:** repo read of `lambda/src/`, `infra/lib/`, `src/`
at commit `e996d85`.

> **Status 2026-07-22: D1–D6 are settled and the spec pack has been reconciled.**
> Every doc in `docs/specs/` plus both root blueprints now carries a
> "Corrections applied 2026-07-22" line naming the conflicts it resolves. §3 below is
> retained as the **rationale log** — it explains *why* the docs read the way they do now.
> §4 is closed; the decisions are recorded there with their resolutions.

> **Phase grouping:** the request referenced "the phases below" but no phase list came
> through. I used the merged phase plan from `INVENTORY_FEATURE_BLUEPRINT.md` §13 and
> `INVOICE_FEATURE_BLUEPRINT.md` §13, sequenced against TRD §8 rollout. Say the word and
> I will regroup against your list.

**Read §3 (conflicts) before writing any code** — six items there change what gets built.

---

## 1. Patterns to copy (verified against the repo)

### 1.1 Lambda handler shape — `lambda/src/tasks.ts`

Every handler is one exported `handler` that routes on `event.httpMethod` +
`event.pathParameters?.id`, wrapped in a single try/catch returning `serverError(err)`.

```
resolveCors(event)  ->  getUid(event)  ->  guardAccount(uid)  ->  if (blocked) return blocked
```

- Sub-routes beyond `{id}` are matched on `event.resource ?? event.path`
  (`clients.ts:41,44` — `path.endsWith('/bulk')`). This is how
  `/invoices/{id}/finalize`, `/cancel`, and `/batches/.../write-off` get routed.
- Writes are **full-item `PutCommand`**, never `UpdateCommand` field patching
  (`tasks.ts:169-183`). Body is `stripTableKeys(parseBody<T>(event))` and the key helper
  is **spread last** so `PK`/`SK` always win (`tasks.ts:173`, `clients.ts:228`).
- Every handler declares its own local `interface` with an
  `[key: string]: unknown` index signature (`tasks.ts:8-16`) — types are **not** imported
  from the frontend.
- Every handler defines its own private `stripKeys` at the bottom
  (`tasks.ts:195`, `clients.ts:378`, `dashboard.ts:157`). It is duplicated, not shared.
- `parseBody<T>` is likewise duplicated per file (`tasks.ts:190`).

### 1.2 List + pagination — `tasks.ts:40-102` / `clients.ts:63-126`

- `Query` on `PK = :pk` with `FilterExpression: begins_with(SK, :prefix)`.
- `limit` is clamped: `Math.min(parseInt(q.limit ?? '50'), 200)`.
- `nextToken` is base64 of `LastEvaluatedKey`, both directions
  (`tasks.ts:54` decode, `tasks.ts:97-99` encode). Returns `null`, never `undefined`.
- **A date-range query gets its own self-contained function** with its own
  KeyCondition/Filter/values — never a shared expression seed. See the comments at
  `tasks.ts:104-108` and `clients.ts:128-132`; this convention exists because sharing the
  seed caused a real bug. `GET /batches?expiringInDays=30` follows this exactly.

### 1.3 Key helpers — `lambda/src/lib/db.ts`

One flat `keys` object, `PK = USER#<uid>`, entity prefix in the SK (`db.ts:14-19`).
`db` is a `DynamoDBDocumentClient` with `removeUndefinedValues: true` — optional fields
can be passed as `undefined` without special-casing.

### 1.4 Responses — `lambda/src/lib/response.ts`

`ok` / `created` / `noContent` / `badRequest` / `notFound` / `forbidden` /
`tooManyRequests` / `serverError`, all through `corsHeaders()`. `resolveCors` must run
before any response is built (module-level `requestOrigin`, `response.ts:11-18`).

**Two shapes exist, and they disagree** — `badRequest`/`notFound` emit
`{ error: <human message> }` (`response.ts:45-55`) while `forbidden`/`tooManyRequests`
emit `{ error: CODE, message: ... }` (`response.ts:57-74`). The API contract's
convention block requires the second shape everywhere. See conflict **C4**.

### 1.5 Sanitization — `lambda/src/lib/sanitize.ts`

`stripTableKeys(body)` drops caller-supplied `PK`/`SK`. Run on **every** inbound body,
including each element of a bulk array (`clients.ts:286`).

### 1.6 Bulk writes — `lambda/src/lib/batch.ts`

`batchWriteAll(requests, deadline)` chunks by 25, retries `UnprocessedItems` with
backoff, returns `{ persisted, timedOut }` — the honest count, not the attempted count.
`BULK_DEADLINE_MS = 20_000`, computed **once at handler entry** if a handler makes
multiple calls. Validate every row up front so a bad row is rejected before any write
(`clients.ts:283-297`).

### 1.7 Frontend service — `src/shared/services/apiService.ts`

*(note: the path is `src/shared/services/`, not `src/services/`)*

Private `request<T>()` (line 36) attaches the Cognito ID token, throws `ApiError(status,
message, code)` where `code = body.error`, and returns `undefined` for 204. Each entity
exports a plain object (`clientsApi`, `tasksApi`) whose `list` builds `URLSearchParams`
inline — **there is no shared `qs()` helper**, contrary to the blueprints; each `list`
repeats the pattern (`apiService.ts:100-112`).

### 1.8 Feature hook — `src/features/clients/hooks/useClients.ts`

`useAuth()` gate -> `versionRef` guard against stale responses (line 19, checked at
39/44/49/52) -> **exhausts every `nextToken` page** into one array (lines 29-42) ->
`loading`/`error` state -> `refresh` -> mutators that call the API then patch local state
(`updateClient` line 66) or `refresh()` (`addClient` line 60). Pagination is
**client-side slicing** of the fully-fetched array (line 105). Toasts are raised by the
**page**, not the hook.

### 1.9 Feature page — `src/features/clients/pages/Clients.tsx`

Filters/search/sort state at the top, feeding the hook. `useToast()` for
`success`/`error`. Modals as sibling components at the bottom of the JSX. Excel import is
`<input type="file" hidden>` + `parseExcel` -> preview modal -> `bulkAdd`. Tailwind
utility classes inline, FontAwesome icons, `font-mono` for headings/labels.

### 1.10 Nav + routes

`src/App.tsx` — one `<Route>` per page inside the `<PrivateRoute />` group.
`Sidebar.tsx:31-37` and `MobileNav.tsx:25-31` each hold their own hardcoded `navItems`
array; both must be edited (labels already differ between them — "My Organization" vs
"My Team").

### 1.11 Infra — `infra/lib/biztrack-stack.ts`

**This is the live stack** (`infra/bin/infra.ts` instantiates `BiztrackStack`). It owns
the table, all 5 GSIs (lines 102-141), every Lambda, every API Gateway route, throttles,
and the reserved-concurrency gate `rc()` (line 263). `infra/lib/infra-stack.ts` is dead
`cdk init` scaffold. See conflict **C2**.

---

## 2. File-by-file build plan

Legend: **[N]** new file · **[M]** modify existing.

### Phase 0 — Decisions & infra prerequisites

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 0.1 | — | Resolve conflicts **C1-C6** in §3 | Blocks everything below |
| 0.2 | `infra/lib/biztrack-stack.ts` | **[M]** add the new expiry GSI | Mirrors the `addGlobalSecondaryIndex` blocks at lines 102-141. Name per **C1**; one GSI per deploy (**C2**) |
| 0.3 | `infra/test/infra.test.ts` | **[M]** assert the new index + new routes exist | Existing CDK assertion test |

### Phase 1 — Shared types & pure helpers (frontend)

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 1.1 | `src/shared/types/index.ts` | **[M]** add `Product`, `Batch`, `StockMovement`, `Invoice`, `InvoiceLine` + `ProductCategory`, `StockStatus`, `MovementType`, `DiscountTier`, `InvoiceType`, `InvoiceStatus` | Mirrors the `Client`/`Task` interface block (lines 48-77). Category values per **C5** |
| 1.2 | `src/shared/utils/inventory.ts` | **[N]** `getStockStatus`, `getExpiryStatus`, `productValue`, `vpInStock`, roll-up totals | New; sibling of `src/shared/utils/dateUtils.ts`. Uses `date-fns` (already a dep) |
| 1.3 | `src/shared/utils/pricing.ts` | **[N]** `priceForTier(product, tier)`, `roundVp`, `formatInr` | New. VP: sum then round once (TRD §7); INR via `toLocaleString('en-IN')` |
| 1.4 | `src/shared/utils/inventory.test.ts` | **[N]** boundary tests | **First test file in the repo** — see conflict **C6** |
| 1.5 | `src/shared/utils/pricing.test.ts` | **[N]** tier -> price mapping, VP tier-independence, worked example from Invoice blueprint §14 | Same |

### Phase 2 — Backend: products, batches, stock engine

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 2.1 | `lambda/src/lib/db.ts` | **[M]** add `product`, `batch`, `stockMove`, `invoice`, `counter` key helpers | Mirrors `keys.task` / `keys.client` (lines 14-19) |
| 2.2 | `lambda/src/lib/response.ts` | **[M]** add `conflict(code, message, extra)`; add code-aware `badRequest` overload | Mirrors `forbidden` (lines 57-65). Required for `409 INSUFFICIENT_STOCK` / `DUPLICATE`, `400 TOO_MANY_LINES` — see **C4** |
| 2.3 | `lambda/src/lib/stock.ts` | **[N]** shared `applyStockChange()` — builds the `TransactWrite` items for batch delta + product roll-up + movement | **No existing mirror — this is the one genuinely new pattern.** No `TransactWriteCommand` exists anywhere in `lambda/src` today. Conditional-write style to copy: `whatsappTest.ts:45,62` |
| 2.4 | `lambda/src/products.ts` | **[N]** `GET/POST /products`, `GET/PUT/DELETE /products/{id}`, `POST/DELETE /products/bulk`, `GET /products/{id}/batches` | Handler skeleton from `tasks.ts`; bulk + `/bulk` path routing from `clients.ts:44-47,267-320` |
| 2.5 | `lambda/src/batches.ts` | **[N]** `GET /batches` (expiry range), `PUT /batches/{productId}/{expiry}`, `POST /batches/{productId}/{expiry}/write-off` | Range query is a **self-contained function** mirroring `tasks.ts::listTasksByDateRange` (lines 109-161) |
| 2.6 | `lambda/src/stockMovements.ts` | **[N]** `GET /stock-movements` only (read-only audit) | Mirrors `tasks.ts::listTasks`. **No POST** — see **C3** |
| 2.7 | `infra/lib/biztrack-stack.ts` | **[M]** 3 new `lambda.Function`s + `/products`, `/products/{id}`, `/products/bulk`, `/products/{id}/batches`, `/batches`, `/stock-movements` resources | Mirrors the clients/tasks Lambda + resource blocks (lines 284-299, 420-444). Add `rc(n)` entries to the plan comment at lines 248-259 and per-method throttles at lines 405-411 |

### Phase 3 — Frontend: inventory page

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 3.1 | `src/shared/services/apiService.ts` | **[M]** add `productsApi`, `batchesApi`, `stockApi` + response/filter interfaces | Mirrors `clientsApi` (lines 99-135). Build query strings inline — no `qs()` helper exists (**C3**) |
| 3.2 | `src/features/inventory/hooks/useInventory.ts` | **[N]** products + batches, filters, mutators | Mirrors `useClients.ts` beat-for-beat: `versionRef`, page exhaustion, client-side slicing |
| 3.3 | `src/features/inventory/hooks/useInventoryStats.ts` | **[N]** valuation totals + expiring/expired/low-stock counts | Mirrors `useDueClients` (`useClients.ts:124-177`) |
| 3.4 | `src/features/inventory/components/InventoryValueCards.tsx` | **[N]** 3 metric cards | Mirrors the dashboard metric-card markup |
| 3.5 | `src/features/inventory/components/ProductSummaryTable.tsx` | **[N]** per-product roll-up + totals row | Mirrors the Clients table (`Clients.tsx:545-659`) |
| 3.6 | `src/features/inventory/components/BatchTable.tsx` | **[N]** one row per product+expiry, Edit + Write off actions | Same table pattern |
| 3.7 | `src/features/inventory/components/ExpiryBadge.tsx` | **[N]** Expired / Expiring soon / OK | Mirrors the inline pill spans at `Clients.tsx:617-628` |
| 3.8 | `src/features/inventory/components/StockBadge.tsx` | **[N]** In / Low / Out of stock | Same |
| 3.9 | `src/features/inventory/components/ProductFilters.tsx` | **[N]** search + category + stock-status | Mirrors `clients/components/ClientFilters.tsx` |
| 3.10 | `src/features/inventory/components/ProductModal.tsx` | **[N]** catalogue fields only | Mirrors `clients/components/ClientModal.tsx` |
| 3.11 | `src/features/inventory/components/BatchModal.tsx` | **[N]** qty/expiry correction | Same |
| 3.12 | `src/features/inventory/components/WriteOffModal.tsx` | **[N]** confirm qty + value + reason | Mirrors `shared/components/common/ConfirmationModal.tsx` (`isDestructive`, `isLoading` props) |
| 3.13 | `src/features/inventory/pages/Inventory.tsx` | **[N]** cards + summary + batch detail | Mirrors `clients/pages/Clients.tsx` layout and toast usage |
| 3.14 | `src/App.tsx` | **[M]** `<Route path="/inventory" element={<Inventory />} />` | Inside `<PrivateRoute />` |
| 3.15 | `src/shared/components/layout/Sidebar.tsx` | **[M]** `navItems` += Inventory (`faBoxesStacked`) | Line 31-37 |
| 3.16 | `src/shared/components/layout/MobileNav.tsx` | **[M]** same entry | Line 25-31 |

### Phase 4 — Backend: invoices

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 4.1 | `lambda/src/invoices.ts` | **[N]** list/get/create/update/finalize/cancel/delete, atomic counters, server-side re-pricing, stock application via `lib/stock.ts` | Handler skeleton from `tasks.ts`; sub-path routing (`/finalize`, `/cancel`) from `clients.ts:41-47`; atomic counter via `UpdateCommand ADD` as in `clients.ts:348-357` |
| 4.2 | `lambda/src/lib/stock.ts` | **[M]** extend for multi-line transactions + reversal | Must aggregate per-product roll-up deltas: two lines of the same product in one invoice would otherwise write the same item twice and fail the transaction |
| 4.3 | `infra/lib/biztrack-stack.ts` | **[M]** invoices Lambda + `/invoices`, `/invoices/{id}`, `/invoices/{id}/finalize`, `/invoices/{id}/cancel` | Same resource pattern as `/user/org/{nodeId}` (lines 456-462) |

### Phase 5 — Frontend: invoices (sale first, then purchase)

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 5.1 | `src/shared/services/apiService.ts` | **[M]** add `invoicesApi` | Mirrors `tasksApi` (lines 155-180) |
| 5.2 | `src/features/invoices/hooks/useInvoices.ts` | **[N]** list by type + create/finalize/cancel/delete | Mirrors `useClients.ts` |
| 5.3 | `src/features/invoices/hooks/useProductCatalogue.ts` | **[N]** load products once for pickers | Mirrors `clients/hooks/useClientQuickSearch.ts` |
| 5.4 | `src/features/invoices/components/ProductPicker.tsx` | **[N]** searchable by name / stockNo | Mirrors `useClientQuickSearch` consumer UI |
| 5.5 | `src/features/invoices/components/BatchPicker.tsx` | **[N]** expiries with qty-on-hand (SALE only) | New; select styled like `ClientFilters` selects |
| 5.6 | `src/features/invoices/components/TierSelect.tsx` | **[N]** 0/25/35/42/50, SALE only | Same |
| 5.7 | `src/features/invoices/components/PartyFields.tsx` | **[N]** Billed to / Bought from | Mirrors `ClientModal` field rows; phone via `shared/components/common/PhoneNumberInput.tsx` |
| 5.8 | `src/features/invoices/components/InvoiceLineRow.tsx` | **[N]** line editor, type-driven columns | New |
| 5.9 | `src/features/invoices/components/InvoiceTotals.tsx` | **[N]** sticky footer totals | New |
| 5.10 | `src/features/invoices/pages/InvoiceBuilder.tsx` | **[N]** shared SALE/PURCHASE builder | Mirrors `Clients.tsx` page structure |
| 5.11 | `src/features/invoices/pages/InvoiceView.tsx` | **[N]** read-only + Print/Finalize/Cancel | New |
| 5.12 | `src/features/invoices/components/InvoicePrint.tsx` | **[N]** print layout, no cost/profit | New; `window.print()` + print stylesheet (decision **D2**) |
| 5.13 | `src/index.css` | **[M]** `@media print` block | Mirrors the existing `@layer base` block (lines 33-59) |
| 5.14 | `src/features/invoices/pages/Invoices.tsx` | **[N]** Sales / Purchases tabs | Mirrors `Clients.tsx` two-section layout |
| 5.15 | `src/App.tsx` | **[M]** `/invoices`, `/invoices/new/:type`, `/invoices/:id` | |
| 5.16 | `Sidebar.tsx` + `MobileNav.tsx` | **[M]** Invoices entry (`faFileInvoiceDollar`) | |

### Phase 6 — Alerts (dashboard + WhatsApp report)

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 6.1 | `lambda/src/dashboard.ts` | **[M]** add expiring / expired / low-stock / stockValue / vpInStock to `counts` | Add to the existing `Promise.all` (lines 25-117). Note it is already a 6-query aggregate throttled to 5 rps — see **C2** note |
| 6.2 | `src/shared/services/apiService.ts` | **[M]** extend `DashboardResponse.counts` | Lines 184-197 |
| 6.3 | `src/features/dashboard/pages/Dashboard.tsx` | **[M]** 3 alert cards linking to filtered Inventory | Existing KPI card row |
| 6.4 | `lambda/src/whatsappScheduler.ts` | **[M]** "Inventory alerts" section in `buildMessage` | Mirrors the tasks section (lines 120-150). **WhatsApp only — no email report exists (C3)** |
| 6.5 | `src/shared/types/index.ts` | **[M]** `User.inventoryAlertsEnabled`, `User.expiryAlertDays` | Mirrors `reportEnabled` (line 30) |
| 6.6 | `src/features/profile/pages/Profile.tsx` | **[M]** toggle + days input | Mirrors the report toggle at lines 440-447 |

### Phase 7 — Excel import/export

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 7.1 | `src/shared/utils/excelUtils.ts` | **[M]** `parseExcel` header detection must be parameterized, plus `validateProductRow` + `exportProductsToExcel` | **`parseExcel` currently hardcodes client header keys** (`requiredName`/`requiredMobile`, lines 134-135) and silently falls back to row 0 for any other sheet — see **C3** |
| 7.2 | `src/features/inventory/components/ImportPreviewModal.tsx` | **[N]** product import preview | Copy of `clients/components/ImportPreviewModal.tsx` (tightly bound to `Client`; copy, do not generalize) |
| 7.3 | `src/features/inventory/pages/Inventory.tsx` | **[M]** wire Import/Export buttons | Mirrors `Clients.tsx:267-285` file-input pattern |
| 7.4 | `docs/inventory/herbalife_products_seed.json` | seed via `POST /products/bulk` | 57 rows, 15 categories (**C5**) |

### Phase 8 — Polish & verification

| # | File | Action | Mirrors / note |
|---|------|--------|----------------|
| 8.1 | all new pages | **[M]** loading skeletons, empty states, 409 line highlighting | Per `06_UI_REFERENCE` §8 |
| 8.2 | `lambda/` test harness | **[N]** if backend tests are wanted | None exists — see **C6** |
| 8.3 | `README.md` / `APPLICATION_OVERVIEW.md` | **[M]** document the new module | |

---

## 3. Spec vs. repo conflicts

### C1 — `GSI3` is already taken. **Blocking.**

TRD §6, Data Model §5/§7 and Inventory blueprint §4 all specify a new index
**`GSI3-BatchExpiry`** with attributes `GSI3PK` / `GSI3SK`.

The live table already has, in `infra/lib/biztrack-stack.ts`:

| Index | Partition | Sort |
|-------|-----------|------|
| `GSI1-FollowUpDate` | `PK` | `nextFollowUpDate` |
| `GSI2-TaskStatus` | `PK` | `dueDate` |
| **`GSI3-ClientName`** | `PK` | `clientNameLower` |
| `GSI4-MobileDigits` | `PK` | `mobileDigits` |
| `GSI5-ReportSchedule` | `reportSchedulePK` | `reportScheduleSK` |

`GSI3-ClientName` is in active use by `clients.ts:88`. Two sub-problems:

1. **Name collision** — the new index must be `GSI6-BatchExpiry`.
2. **Attribute-naming convention** — the spec's `GSI3PK`/`GSI3SK` synthetic attributes do
   not match the repo. Every per-user index here uses `PK` + the *real* attribute name as
   sort key, relying on sparseness (only items carrying that attribute appear) plus a
   `begins_with(SK, :prefix)` filter. Only the cross-user `GSI5` uses synthetic keys, and
   only because it is not partitioned by user.

**Resolved (D1):** `GSI6-InventoryDate` = `PK` + `invDate`, `ProjectionType.ALL` — one
sparse index shared with invoices (see C7). Batches write `invDate = expiryDate`, invoices
write `invDate = createdAt`; queries separate them with an `SK` prefix filter. The range
query is a line-for-line copy of `tasks.ts::listTasksByDateRange`. All docs updated.

### C2 — The infra "stub" note is wrong; the stack is in this repo. **Blocking.**

TRD §6 and Inventory blueprint §4 both state: *"`infra/lib/infra-stack.ts` is a stub —
the live table was provisioned out-of-repo. Adding `GSI3` is a console/CLI/IaC change on
the real table, not just a code change."* This drove the "no-GSI fallback" contingency.

In fact `infra/bin/infra.ts` instantiates **`BiztrackStack`** from
`infra/lib/biztrack-stack.ts` — 511 lines defining the table, all 5 GSIs, all 8 Lambdas,
the full API Gateway route tree, Cognito, EventBridge, S3 and CloudFront.
`infra/lib/infra-stack.ts` is unused `cdk init` scaffold.

Consequences:

- The GSI, the new Lambdas, and every new API route **are code changes in this repo** and
  must be added to `biztrack-stack.ts`. No spec doc lists that file — every phase above
  that touches the backend now does.
- The "no-GSI fallback" is a real option but no longer a *necessity*.
- CloudFormation permits **one GSI add per stack update**; we only need one, so fine, but
  do not batch it with other index changes.
- Three new Lambdas need entries in the reserved-concurrency plan comment
  (`biztrack-stack.ts:248-259`, currently summing to 179) and the heavy ones
  (`/products/bulk`, `/invoices` POST) want per-method throttles alongside
  `/clients/bulk` at lines 405-411.
- `/dashboard/GET` is throttled to **5 rps / 10 burst** and already runs 6 parallel
  queries. Phase 6 adds up to 3 more, and `stockValue`/`vpInStock` require reading every
  product. Either accept the cost or cache the valuation on the profile item the way
  `clientCount` is cached (`clients.ts:348-368`).

### C3 — Stale statements inside the blueprints (spec contradicts spec and repo)

| Where | Says | Reality |
|-------|------|---------|
| Inventory blueprint §5 heading, §6 | `stockMovements.ts` handles "POST-with-quantity-adjust"; `stockApi.record()`; `useStockMovements().record()` (§8) | Contradicts the same doc's §5 note, PRD §6 decision 3, and API contract §4 — movements are **write-side-effect only**. The §5/§6/§8 mentions are pre-batch-model leftovers. Build read-only. |
| Inventory blueprint §8 derived helpers | `p.quantity`, `p.expiryDate` | Batch model uses `p.totalQuantity` / `p.earliestExpiry`. Stale. |
| Inventory blueprint §5 step 2 | `ADJUST` sets quantity absolutely on the **product** | Under batch tracking, adjustments target a **batch**; the product roll-up is derived. |
| Inventory blueprint §7, Invoice blueprint §8 | uses a shared `qs()` helper "already inlined in `clientsApi.list`" | No `qs()` exists. `clientsApi.list` builds `URLSearchParams` inline (apiService.ts:100-112). Either add a real `qs()` (nice) or repeat the inline pattern (consistent). |
| Invoice blueprint §7 | "reuse the stock-out movement writer from `stockMovements.ts`" | Movements are written by the transaction builder; put it in `lambda/src/lib/stock.ts`, not in the read-only handler. |
| PRD §4.6, TRD §4, App Flow §4.2, Inventory §10.2 | "existing **WhatsApp/email** daily report" | **There is no email report.** `whatsappScheduler.ts` posts to the Meta Graph API; no SES client, no `@aws-sdk/client-ses`, nothing. Adding email means a new provider, contradicting TRD §4 "No new provider". Scope it as WhatsApp-only or raise it as new work. |
| Inventory blueprint §6 / App Flow §5 | Excel import "copy from clients" | `parseExcel` (`excelUtils.ts:118-165`) hardcodes client header detection (`name`/`mobile` synonyms, lines 134-135). For a product sheet it finds no header and falls back to row 0 — which happens to work for the seed file but breaks on any sheet with a title row. `parseExcel` needs a header-spec parameter. |

### C4 — Error shape: the contract needs response helpers that don't exist

API contract requires `{ "error": "CODE", "message": "human text" }` for every error, and
the UI branches on codes (`INSUFFICIENT_STOCK`, `DUPLICATE`, `TOO_MANY_LINES`,
`NOT_DRAFT`, `STOCK_ALREADY_SOLD`, `VALIDATION`).

Today `badRequest(message)` produces `{ error: <the whole sentence> }`
(`response.ts:45-49`) and `notFound` likewise. The frontend `ApiError` maps
`code = body.error` (`apiService.ts:58`), so a current 400 yields
`code === "title is required"` — unusable for branching. There is also **no 409 helper at
all**.

Fix in Phase 2.2: add `conflict(code, message, extra)` mirroring `forbidden`, and use a
code-carrying `badRequest` for new endpoints. Leave existing handlers alone — changing
`badRequest`'s shape globally would alter the clients/tasks contract.

### C5 — Product categories don't match the seed data

Inventory blueprint §3 defines:
`'Vitamins' | 'Minerals' | 'Protein' | 'Herbal' | 'Probiotics' | 'Omega' | 'Other'`.

`docs/inventory/herbalife_products_seed.csv` (57 rows) actually contains **15** categories,
none of which are in that list:

> Bone & Joint Health · Brain Health · Cardiovascular Health · Children's Health ·
> Digestive Health · Energy · Enhancers · Eye Health · Immune Health · Men's Health ·
> Skin & Body Care · Sleep Support · Sports Nutrition · Weight Management · Women's Health

PRD §4 and the API contract example use "Weight Management", matching the seed.
**Recommendation:** derive `ProductCategory` from the seed's 15 values (plus `'Other'`).
Otherwise every seeded row fails enum validation on import.

### C6 — No test infrastructure for the tests the specs assume

TRD §2 lists "Vitest (frontend), Jest (infra)".

- **Frontend:** Vitest is installed and configured, but `environment: 'node'` and
  `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']` (`vite.config.ts`). **There are zero
  test files in `src/`.** Pure-logic tests (Phase 1.4/1.5) work today. Any *component*
  test needs `jsdom` + `@testing-library/react`, neither installed.
- **Infra:** Jest is real and working (`infra/jest.config.js`, `infra/test/infra.test.ts`).
- **Lambda:** no runner at all — `lambda/package.json` test script is
  `echo "Error: no test specified" && exit 1`. Inventory blueprint §12 asks for backend
  unit tests of the stock math and a mocked `TransactWrite` atomicity test. That needs new
  tooling in `lambda/` (decision **D3**).

### C7 — Invoice SK breaks point reads and idempotency (spec-internal, but decide now)

Invoice blueprint §5 gives the key helper as `SK: INVOICE#${id}` and then, three lines
later, says the item is `SK = INVOICE#<createdAt>#<id>`. Data Model §7 says the latter.

With `createdAt` in the SK you **cannot `GetItem` by id alone** — which
`GET /invoices/{id}`, `POST /invoices/{id}/finalize`, `/cancel` and `DELETE` all need. It
also breaks the idempotency mechanism: the `attribute_not_exists(PK)` guard (TRD §5) must
be applied to a key derivable from the client-generated id, and the server assigns
`createdAt`.

With plain `SK = INVOICE#<id>` point reads and idempotency work, but native newest-first
`ScanIndexForward:false` pagination is lost (uuids sort meaninglessly).

**Recommendation:** base-table `SK = INVOICE#<id>` for point reads + idempotency, and get
chronological ordering from the same new index as batches — make it
`GSI6-InventoryDate` = `PK` + `invDate`, where batches write `invDate = expiryDate` and
invoices write `invDate = createdAt`. Both queries then filter by SK prefix, exactly as
`GSI1`/`GSI2` already do (`dashboard.ts:38`, `tasks.ts:82`). One index, both needs, zero
new conventions.

---

## 4. Decisions — SETTLED 2026-07-22

| # | Decision | Resolution | Recorded in |
|---|----------|-----------|-------------|
| D1 | Index name/shape per **C1** + **C7** | `GSI6-InventoryDate` = `PK` + `invDate`, shared by batches and invoices | TRD §6, Data Model §3/§4/§7 |
| D2 | PDF approach | `window.print()` + print stylesheet. `jspdf` **not** added | TRD §2, PRD §8, Invoice bp §10 |
| D3 | Backend tests in `lambda/` | Vitest in `lambda/`, testing `lib/stock.ts` transaction-item construction as a pure function | TRD §2, Inventory bp §12 |
| D4 | `ProductCategory` source of truth per **C5** | The seed's 15 categories + `'Other'` | PRD §7, Inventory bp §3 |
| D5 | Email alerts per **C3** | Out of scope; WhatsApp only (no email pipeline exists) | PRD §4.6, TRD §4, App Flow §4.2, Inventory bp §10.2 |
| D6 | Invoice number yearly reset | Counter stores `{ seq, year }`, resets each January | Data Model §6, TRD §5, Invoice bp §5 |

---

## 5. Implementation notes that are easy to get wrong

1. **Same item twice in one transaction fails.** Two lines of the same product (different
   expiries) both touch the product roll-up. Aggregate per-product deltas into one update
   before building the transaction — the spec covers duplicate `(productId, expiry)` pairs
   but not this case.
2. **Transaction size.** `1 + lines x 2 + distinctProducts` <= 100. The 30-line cap gives
   at most 91. Validate server-side before building anything.
3. **Counter increment sits outside the transaction.** Increment first; if the transaction
   fails the number is burned. Gaps are by design (TRD §5) — do not reuse.
4. **`earliestExpiry` after a SALE** cannot be recomputed inside the transaction (no
   queries allowed). Recompute after; brief staleness only ever warns early.
5. **`resolveCors(event)` must be the first line** of every new handler — `corsHeaders()`
   reads module state set by it (`response.ts:11`).
6. **Spread key helpers last.** `{ ...body, ...keys.product(uid, id) }`, after
   `stripTableKeys`. Both, always — that pairing is what prevents cross-partition writes.
7. **`getUid` throws on a missing authorizer**, and the handler-level catch turns it into a
   500, not the 401 the contract promises. Inherited from `tasks.ts`; fix globally or
   accept the inconsistency.
8. **Date-only expiry strings** (`YYYY-MM-DD`) never get `new Date().toISOString()`
   treatment — existing handlers use full ISO timestamps for dates, so this is a new
   convention living alongside the old one. Keep them clearly separated in the types.
