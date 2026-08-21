# Biztrack — Inventory & Invoicing spec pack

Planning documents for the Inventory + Sales/Purchase Invoicing feature. Read in order.
No code is written yet; these define the build.

| # | Doc | Purpose |
|---|-----|---------|
| 01 | `01_PRD.md` | What & why — problem, users, features, scope (v1 vs later) |
| 02 | `02_TRD.md` | How technically — stack, architecture, non-functional requirements |
| 03 | `03_APP_FLOW.md` | Step-by-step user journeys + error/edge cases |
| 04 | `04_DATA_MODEL.md` | Entities, fields, relationships, DynamoDB keys, ERD |
| 05 | `05_API_CONTRACT.md` | Endpoints, request/response shapes, auth, errors |
| 06 | `06_UI_REFERENCE.md` | Wireframes + style guide (colors, fonts, components) |
| 07 | `07_BUILD_PLAN.md` | File-by-file execution list + the spec/repo conflict log |
| 09 | `09_VERIFICATION.md` | What has been observed working against the deployed stack, per phase |

### Deeper implementation detail
- `../../INVENTORY_FEATURE_BLUEPRINT.md` — file-by-file inventory build spec
- `../../INVOICE_FEATURE_BLUEPRINT.md` — file-by-file sales/purchase build spec

### Seed data (ready to import)
- `../inventory/herbalife_products_seed.{csv,json,xlsx}` — 57 products, VP + all price tiers

### Locked decisions (see PRD §6)
Batch tracking · one tier per sale · pick batch by expiry on sale · restock = purchase
invoice · stock changes only via invoices (+ write-off for expired/damaged) · 0% = Retail ·
cost/profit never on customer bill · max 30 lines/invoice · zero-qty batches kept but hidden ·
product categories come from the seed file (15 values + Other) · PDF = browser
`window.print()`, no new dependency · alerts are WhatsApp only (no email pipeline exists).

### Engineering guarantees (see TRD §5, Data Model §8)
Conditional writes for oversell protection · client-generated invoice id **as the whole
sort key** (`INVOICE#<id>`) for idempotent saves and point reads · atomic TransactWrite for
all stock changes, with per-product roll-up deltas aggregated first · server-side price
recompute · invoice numbers reset yearly from a `{ seq, year }` counter, and sequence gaps
are acceptable · every new endpoint returns `{ error: CODE, message }`.

### Indexing & infra
One new index, **`GSI6-InventoryDate`** (`PK` + `invDate`), shared by batches
(`invDate = expiryDate`, expiry range queries) and invoices (`invDate = createdAt`,
newest-first listing). `GSI3` was the name in earlier drafts and is **taken** by
`GSI3-ClientName`. The table, its indexes, every Lambda and every route are declared in
`infra/lib/biztrack-stack.ts` — live IaC in this repo, deployed with `cdk deploy`.

*Reviewed 2026-07-19: added finalize + write-off endpoints, concurrency/idempotency
mechanisms, transaction-size cap, upsert semantics, batch re-key policy, UI states.*

*Corrections applied 2026-07-22: reconciled the pack against the repo and settled D1–D6 —
index renamed `GSI6-InventoryDate` (C1); infra "provisioned out-of-repo" note and the
no-GSI fallback removed (C2); stale blueprint statements fixed (C3); error-shape section
added to the API contract (C4); `ProductCategory` taken from the seed (C5); Vitest added to
`lambda/` (C6/D3); invoice sort key changed to `INVOICE#<id>` (C7). Full log:
`07_BUILD_PLAN.md` §3.*
