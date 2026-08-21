# Data Model / Schema — Biztrack Inventory & Invoicing

Single-table DynamoDB (`biztrack`). All items: `PK = USER#<uid>`, `SK = <ENTITY>#...`.
**Last updated:** 2026-07-19
**Corrections applied 2026-07-22:** resolves C1 (index is `GSI6-InventoryDate` = `PK` +
`invDate`; `GSI3` is already `GSI3-ClientName` on the live table), C7 (invoice
`SK = INVOICE#<id>` so point reads and the idempotency guard work; ordering moves to
`GSI6`), D6 (counter stores `{ seq, year }`).

---

## 1. Entity relationship (ERD)

```
        ┌───────────┐  1        ∞  ┌───────────┐
        │  Product  │───────────────│   Batch   │   (product + one expiry + qty)
        └───────────┘               └───────────┘
              │ 1                          ▲
              │                            │ deducted from / added to
              │ ∞                          │
        ┌───────────┐  1        ∞  ┌───────────────┐
        │  Invoice  │───────────────│  InvoiceLine  │
        │ SALE/PURCH│               │ (embedded)    │
        └───────────┘               └───────────────┘
              │ writes
              ▼ ∞
        ┌───────────────┐        ┌──────────────────┐
        │ StockMovement │        │ Counter (per type)│  INV / PUR sequence
        └───────────────┘        └──────────────────┘

User (PROFILE) owns all of the above (PK = USER#<uid>).
```

Relationships:
- **Product 1—∞ Batch** — a product's on-hand qty = Σ its batches' quantities.
- **Invoice 1—∞ InvoiceLine** — lines are embedded in the invoice item (not separate rows).
- **InvoiceLine → Batch** — each line references a batch by `(productId, expiryDate)`.
- **Invoice → StockMovement** — finalizing writes one movement per line.
- **Counter** — one per user per invoice type, supplies sequential numbers.

---

## 2. Product

Catalogue item + cached roll-ups. Stock itself lives on batches.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | uuid |
| `name` | string | e.g. "Formula 1 — Strawberry - 500 gms" |
| `nameLower` | string? | normalized for search |
| `stockNo` | string? | Herbalife stock no. ("1239", "127K") |
| `category` | enum | Weight Management, Energy, … |
| `brand` | string? | |
| `vp` | number | volume points per piece |
| `retail` | number | 0% price |
| `price25` `price35` `price42` | number | discount tiers |
| `price50` | number | 50% = cost / default buy price |
| `unit` | string? | 'units', 'bottles' … |
| `reorderLevel` | number | low-stock threshold |
| `totalQuantity` | number | cached Σ batch.quantity |
| `earliestExpiry` | string? | cached min(batch.expiryDate) |
| `notes` | string? | |
| `createdAt` `updatedAt` | string | ISO |

Keys: `PK = USER#<uid>`, `SK = PRODUCT#<id>`.

**Derived (not stored):** `stockStatus` (from totalQuantity vs reorderLevel),
`value = totalQuantity × price50`, `vpInStock = totalQuantity × vp`.

---

## 3. Batch

A quantity of one product with a single expiry.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | = `${productId}#${expiryDate}` |
| `productId` | string | FK → Product.id |
| `productName` | string? | snapshot |
| `expiryDate` | string | ISO date `YYYY-MM-DD` |
| `invDate` | string | **= `expiryDate`** — the `GSI6-InventoryDate` sort key (see below) |
| `quantity` | number | units in this batch |
| `createdAt` `updatedAt` | string | ISO |

Keys: `PK = USER#<uid>`, `SK = BATCH#<productId>#<expiryDate>`.
GSI `GSI6-InventoryDate`: `PK = USER#<uid>`, `invDate = <expiryDate>`.

> `invDate` duplicates `expiryDate` because the index is **shared with invoices**, which
> sort on `createdAt` (Data Model §4). Writing one common attribute keeps a single index
> serving both entities; the SK prefix separates them at query time, exactly as
> `GSI1`/`GSI2` already do for clients and tasks.

> Because expiry is in the SK, a same-expiry restock is an atomic `UpdateItem … ADD
> quantity :q`; a new expiry is a new item. List a product's batches with
> `begins_with(SK, 'BATCH#<productId>#')`.

**Policies:**
- **Zero-quantity batches are kept** (movement history references them), hidden by
  default in lists (`includeEmpty=false`).
- **Editing a batch's expiry re-keys it** (the expiry is in the SK): delete old item +
  create/merge at the new key, in one transaction, with an `ADJUST` movement.
- Decrements always carry `ConditionExpression: quantity >= :q` (oversell guard).

---

## 4. Invoice + InvoiceLine

One item per invoice; lines embedded.

**Invoice**

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | **client-generated uuid** (idempotency key — see §8) |
| `type` | enum | `SALE` \| `PURCHASE` |
| `invoiceNo` | string | `INV-2026-0001` / `PUR-2026-0007` (gaps allowed) |
| `date` | string | ISO |
| `tier` | 0\|25\|35\|42\|50 | SALE: chosen; PURCHASE: always 50 |
| `partyName` | string | customer (SALE) or supplier (PURCHASE) |
| `partyPhone` `partyEmail` `partyAddress` | string? | |
| `lines` | InvoiceLine[] | embedded |
| `totalAmount` | number | Σ lineAmount |
| `totalVp` | number | Σ lineVp (PURCHASE: VP earned) |
| `totalCost` | number? | SALE internal only — never printed |
| `status` | enum | Draft \| Finalized \| Cancelled |
| `stockApplied` | boolean | true once stock moved |
| `notes` | string? | |
| `createdAt` `updatedAt` | string | ISO |
| `invDate` | string | **= `createdAt`** — the `GSI6-InventoryDate` sort key |

Keys: `PK = USER#<uid>`, `SK = INVOICE#<id>`.
Newest-first listing comes from `GSI6-InventoryDate` (`invDate = createdAt`,
`ScanIndexForward: false`, filtered with `begins_with(SK, 'INVOICE#')`).

> **Why the id alone is in the SK (C7).** An earlier draft used
> `SK = INVOICE#<createdAt>#<id>` for native chronological ordering. That breaks two
> things the API depends on:
> 1. **Point reads.** `GET /invoices/{id}`, `POST /invoices/{id}/finalize`, `/cancel` and
>    `DELETE` all address an invoice by id alone; with `createdAt` in the SK there is no
>    key to `GetItem` on without a prior scan.
> 2. **Idempotency.** The duplicate-submit guard is
>    `ConditionExpression: attribute_not_exists(PK)` on the invoice put, keyed on the
>    **client-generated** id — but `createdAt` is assigned by the server, so a retry would
>    compute a different key and the guard would never fire.
>
> `SK = INVOICE#<id>` restores both; ordering moves to `GSI6`, which is being added for
> batch expiry anyway.

**InvoiceLine** (embedded, snapshotted)

| Field | Type | Notes |
|-------|------|-------|
| `productId` | string | FK |
| `stockNo` | string? | snapshot |
| `name` | string | snapshot |
| `unitPrice` | number | snapshot at tier |
| `unitVp` | number | snapshot of product.vp |
| `quantity` | number | |
| `lineAmount` | number | unitPrice × quantity |
| `lineVp` | number | unitVp × quantity |
| `expiryDate` | string | the batch touched (SALE: sold-from; PURCHASE: shipment) |
| `unitCost` | number? | = price50 — internal, omitted from printed SALE |

---

## 5. StockMovement (audit log)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | uuid |
| `productId` | string | FK |
| `productName` | string? | snapshot |
| `batchExpiry` | string? | which batch |
| `type` | enum | IN \| OUT \| ADJUST \| WRITE_OFF |
| `quantity` | number | positive; sign implied by type |
| `reason` | string? | 'Sale — INV-…', 'Purchase — PUR-…' |
| `createdAt` | string | ISO |

Keys: `PK = USER#<uid>`, `SK = STOCKMOVE#<createdAt>#<id>`. Read-only (written by `applyStockChange`).

---

## 6. Counters

| Field | Type | Notes |
|-------|------|-------|
| `seq` | number | atomic `ADD :1` |
| `year` | number | the year `seq` is counting within |

Keys: `PK = USER#<uid>`, `SK = COUNTER#SALE` or `COUNTER#PURCHASE`.
Number format: `INV-<year>-<zero-padded seq>` / `PUR-<year>-<seq>`.

**Yearly reset (D6).** The counter is scoped to a year. Increment conditionally on
`year = :thisYear`; if that fails, the year has rolled — write `{ seq: 1, year: :thisYear }`
under `attribute_not_exists(SK) OR #year <> :thisYear` and use `1`. So each January
restarts at `INV-<year>-0001`. Gaps within a year remain acceptable by design (TRD §5).

---

## 7. Key map (single table)

| Entity | PK | SK | `GSI6-InventoryDate` (`PK` + `invDate`) |
|--------|----|----|------|
| Profile | `USER#<uid>` | `PROFILE` | — |
| Product | `USER#<uid>` | `PRODUCT#<id>` | — |
| Batch | `USER#<uid>` | `BATCH#<productId>#<expiry>` | `invDate` = `<expiryDate>` |
| Invoice | `USER#<uid>` | `INVOICE#<id>` | `invDate` = `<createdAt>` |
| StockMovement | `USER#<uid>` | `STOCKMOVE#<createdAt>#<id>` | — |
| Counter | `USER#<uid>` | `COUNTER#SALE` / `COUNTER#PURCHASE` | — |

**Index `GSI6-InventoryDate`** — partition `PK`, sort `invDate`, projection `ALL`. Sparse:
only batches and invoices write `invDate`, so products, movements and counters are absent.
Two query shapes, separated by an `SK` prefix filter (mirrors how `GSI1`/`GSI2` are used
for clients and tasks):

- **Expiring batches** — `invDate BETWEEN <today> AND <today+N>` +
  `begins_with(SK, 'BATCH#')`; `invDate < <today>` for expired.
- **Invoices newest-first** — `PK = :pk`, `ScanIndexForward: false` +
  `begins_with(SK, 'INVOICE#')`, optionally filtered by `type`.

> `GSI3` was the name used in earlier drafts. It is **taken** — the live table already has
> `GSI3-ClientName` (client name search), plus `GSI4-MobileDigits` and
> `GSI5-ReportSchedule`. See TRD §6 for the full index inventory.

---

## 8. Invariants (with enforcement mechanism)

| Invariant | Mechanism |
|-----------|-----------|
| `product.totalQuantity` == Σ batch quantities | Both updated in the same `TransactWrite` on every stock change |
| Batch `quantity` never < 0 | `ConditionExpression: quantity >= :q` on every decrement; condition failure cancels the whole transaction → `409` |
| No double-apply on retry | Invoice `id` is client-generated and **is the whole SK** (`INVOICE#<id>`); the invoice put uses `attribute_not_exists(PK)` — a duplicate `POST` fails cleanly instead of re-deducting |
| Same item never written twice in one transaction | Per-product roll-up deltas are **aggregated before** the transaction is built. Two lines of the same product at different expiries touch two batches but one product item — DynamoDB rejects a transaction that addresses the same item twice |
| ≤ 30 lines per invoice | Server-side validation (`400`); derives from the 100-item `TransactWrite` limit (≈ 1 + 3 × lines items) |
| `product.earliestExpiry` == min(batch expiries) | PURCHASE: `min(current, new)` inline in the transaction. SALE/write-off: recomputed post-transaction (queries aren't allowed inside transactions); brief staleness is safe-direction (warns early) |
| Duplicate (product, expiry) lines in one purchase | Server merges them into one batch update before building the transaction |
| Invoice totals correct | Recomputed server-side from catalogue + tier; client-sent prices ignored |
| Finalized invoices immutable | `status` checked on `PUT`; only `cancel` (which reverses stock) and `finalize` mutate post-draft |
| Expiry dates comparable | Date-only ISO strings (`YYYY-MM-DD`) — lexicographic order == chronological order |
