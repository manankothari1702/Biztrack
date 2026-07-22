# Biztrack — Inventory & Expiry Tracking Feature Blueprint

> Build spec for a stock inventory module for a health-supplements business.
> Designed to match Biztrack's existing architecture. Hand this to Claude Code
> and build it phase by phase.

**Corrections applied 2026-07-22** (see `docs/specs/07_BUILD_PLAN.md` §3):
C1/D1 — the expiry index is `GSI6-InventoryDate` (`PK` + `invDate`); `GSI3` is taken.
C2 — `infra/lib/biztrack-stack.ts` is live IaC in this repo; stub note and no-GSI fallback
removed. C3 — `stockMovements` is read-only, movement writes live in `lib/stock.ts`,
`ADJUST` targets a **batch**, roll-up fields are `totalQuantity`/`earliestExpiry`, there is
no `qs()` helper, `parseExcel` needs a header-spec parameter. D3 — Vitest in `lambda/`.
D4 — `ProductCategory` comes from the seed. D5 — WhatsApp only, no email.

---

## 1. Goal

Add an **Inventory** module that lets the user track supplement products, their
stock levels, and expiry dates, with:

- **Expiry alerts** — surface items that are expired or expiring soon (dashboard + the existing WhatsApp report; see §10.2).
- **Low-stock reorder alerts** — warn when quantity drops below a per-product reorder threshold.
- **Excel import/export** — bulk import products and export the catalogue, mirroring the Clients feature.
- **Stock movements log** — an audit trail (see stock-flow rule below), not a manual data-entry screen.

**Stock model chosen:** *batch tracking.* A **product** is the catalogue item; a
**batch** is a quantity of that product with **one expiry date**. A product's on-hand
quantity is the sum of its batches. Restocking with a matching expiry adds to that
batch; a different expiry creates a new batch (a new row).

**Stock-flow rule (design decision):** there are **no manual "Stock In / Stock Out"
buttons.** Stock changes happen only through invoices (see `INVOICE_FEATURE_BLUEPRINT.md`):
1. **Stock out — Sale invoice:** on each sale line the user **selects which batch (by
   expiry date)** the stock comes from; that batch's quantity is decremented (`OUT`).
   Only way stock decreases.
2. **Stock in — Purchase invoice (restock):** each purchase line has an expiry; it
   **adds to the matching batch or creates a new one** (`IN`). Primary way stock increases.
3. **Excel import** can seed products + opening batches in bulk.
4. **Edit** on a product is for catalogue details (name, reorder level, price) — not stock.

The **Inventory page has two parts:** a top **valuation summary** (stock value @50% +
VP in stock, rolled up per product) and a **batch detail table** below (one row per
product-expiry). Row actions on batches = **Edit** (manual correction) and
**Write off** (expired/damaged — a v1 feature, PRD §4.5). See
[§11 batch/lot tracking](#11-future-option--batchlot-tracking) for FEFO auto-pick as a
possible later enhancement (current choice: user picks the batch at sale time).

---

## 2. How this fits the existing architecture

Biztrack is already a serverless AWS app. Inventory copies the exact patterns
used by **Clients** and **Tasks** so nothing new is invented:

| Layer | Existing pattern | Inventory reuses it |
|-------|------------------|---------------------|
| Auth | Cognito via `aws-amplify`, ID token sent as `Authorization` header | Same — no change |
| API | API Gateway REST → one Lambda per entity | New `products` + `stockMovements` Lambdas |
| DB | Single DynamoDB table `biztrack`, `PK = USER#<uid>`, `SK = <ENTITY>#<id>` | New `PRODUCT#` and `STOCKMOVE#` SK prefixes |
| Indexes | `GSI1-FollowUpDate`, `GSI2-TaskStatus`, `GSI3-ClientName`, `GSI4-MobileDigits`, `GSI5-ReportSchedule` — all five live today | New **`GSI6-InventoryDate`** for expiry range queries (`GSI3` is already client name search) |
| Frontend data | `apiService.ts` typed clients → per-feature hooks → pages | New `productsApi` / `stockApi`, `useProducts`, `useStockMovements` |
| UI | `src/features/<name>/{components,hooks,pages}` + route in `App.tsx` + link in `Sidebar.tsx`/`MobileNav.tsx` | New `src/features/inventory/...` |

Key source files to read before starting:

- `lambda/src/lib/db.ts` — table name + `keys` helpers (add product/movement keys here)
- `lambda/src/tasks.ts` — canonical Lambda handler to copy
- `src/shared/services/apiService.ts` — where `productsApi`/`stockApi` go
- `src/features/tasks/hooks/useTasks.ts` — canonical hook to copy
- `src/features/clients/components/ImportPreviewModal.tsx` — Excel import pattern
- `src/App.tsx`, `src/shared/components/layout/Sidebar.tsx`, `MobileNav.tsx` — routing + nav

---

## 3. Data model (TypeScript types)

Add to `src/shared/types/index.ts` (frontend) and mirror the interface inside each
Lambda file (the codebase keeps a local `interface` in `tasks.ts`/`clients.ts` too).

```ts
// ── Inventory ────────────────────────────────────────────────────────────────

// Derived from docs/inventory/herbalife_products_seed.csv (D4) — the catalogue is the
// source of truth. An earlier draft listed Vitamins/Minerals/Protein/Herbal/Probiotics/
// Omega, which match NONE of the 57 seed rows and would fail every row on import.
export type ProductCategory =
  | 'Bone & Joint Health' | 'Brain Health' | 'Cardiovascular Health'
  | "Children's Health"   | 'Digestive Health' | 'Energy'
  | 'Enhancers'           | 'Eye Health'    | 'Immune Health'
  | "Men's Health"        | 'Skin & Body Care' | 'Sleep Support'
  | 'Sports Nutrition'    | 'Weight Management' | "Women's Health"
  | 'Other';

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

// A Product is the catalogue item. A Batch is a quantity of it with ONE expiry.
// Stock lives on batches; the product caches the roll-up for fast lists.
export interface Product {
  id: string;
  name: string;
  nameLower?: string;        // normalized for search (mirrors Client.clientNameLower)
  stockNo?: string;          // Herbalife stock no. (e.g. "1239", "127K")
  category: ProductCategory;
  brand?: string;

  // Pricing (from the seed catalogue) — VP and all tiers:
  vp: number;                // volume points per piece
  retail: number;            // 0% price
  price25: number; price35: number; price42: number;
  price50: number;           // 50% = your cost / default buy price

  unit?: string;             // e.g. 'bottles', 'boxes', 'units'
  reorderLevel: number;      // low-stock threshold (alert when totalQuantity <= this)

  // Cached roll-ups of this product's batches (maintained transactionally on every
  // stock change; batches are the source of truth):
  totalQuantity: number;     // Σ batch.quantity
  earliestExpiry?: string;   // min(batch.expiryDate) — drives the product-level expiry badge

  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// One lot of stock: a product + a single expiry date + a quantity.
// Identified by (productId, expiryDate) so a same-expiry restock merges automatically.
export interface Batch {
  id: string;                // = `${productId}#${expiryDate}`
  productId: string;
  productName?: string;      // snapshot for readability
  expiryDate: string;        // ISO date (YYYY-MM-DD)
  quantity: number;          // units in THIS batch
  createdAt: string;
  updatedAt?: string;
}

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'WRITE_OFF';

export interface StockMovement {
  id: string;
  productId: string;
  productName?: string;
  batchExpiry?: string;      // which batch this movement touched
  type: MovementType;        // IN = purchase, OUT = sale, ADJUST = correction, WRITE_OFF = expired/damaged
  quantity: number;          // always positive; sign implied by `type`
  reason?: string;           // 'Purchase — PUR-…', 'Sale — INV-…', 'Expired', …
  createdAt: string;
}
```

**Derived, not stored** (compute in the hook/UI):

- `stockStatus` (per product): `totalQuantity <= 0` → `Out of Stock`; `<= reorderLevel` → `Low Stock`; else `In Stock`.
- `expiryStatus` (per **batch**): `Expired` (past), `Expiring Soon` (within N days, default 30), `OK`. The product badge uses its `earliestExpiry`.
- **Valuation:** product value = `totalQuantity × price50`; product VP-in-stock = `totalQuantity × vp`. Grand totals = Σ across products (the top summary section).

---

## 4. DynamoDB design (single-table)

Reuse the existing `biztrack` table. Add key helpers to `lambda/src/lib/db.ts`:

```ts
export const keys = {
  profile:  (uid: string) => ({ PK: `USER#${uid}`, SK: 'PROFILE' }),
  client:   (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `CLIENT#${id}` }),
  task:     (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `TASK#${id}` }),
  orgNode:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `ORG#${id}` }),
  // NEW:
  product:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `PRODUCT#${id}` }),
  // batch key = product + expiry → same-expiry restock merges into one item
  batch:    (uid: string, productId: string, expiry: string) =>
              ({ PK: `USER#${uid}`, SK: `BATCH#${productId}#${expiry}` }),
  stockMove:(uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `STOCKMOVE#${id}` }),
};
```

### Item shapes

**Product item** (catalogue + cached roll-ups; no expiry on the product itself)
```
PK = USER#<uid>
SK = PRODUCT#<id>
totalQuantity, earliestExpiry, ...all Product fields
```

**Batch item** (the unit that carries stock + expiry)
```
PK = USER#<uid>
SK = BATCH#<productId>#<expiryDate>
invDate = <expiryDate>     // GSI6-InventoryDate sort key — range queries by expiry
productId, expiryDate, quantity, ...
```
Because expiry is in the SK, a restock at the same expiry is a single atomic
`UpdateItem … ADD quantity :q`; a new expiry is a new item. To list a product's batches:
`Query begins_with(SK, 'BATCH#<productId>#')`.

**Stock movement item**
```
PK = USER#<uid>
SK = STOCKMOVE#<createdAt>#<id>   // ScanIndexForward:false → newest-first
```

### New index: `GSI6-InventoryDate`

- **Partition key:** `PK` (= `USER#<uid>`), **Sort key:** `invDate`, projection `ALL`.
- **Purpose:** "all batches expiring between today and today+30d, sorted" — a range query
  exactly like `tasks.ts::listTasksByDateRange`. Powers expiry alerts at batch granularity.
- **Shared with invoices**, which write `invDate = createdAt` for newest-first listing.
  Queries separate the two with a `begins_with(SK, 'BATCH#')` / `'INVOICE#'` filter,
  exactly as `GSI1`/`GSI2` already do for clients and tasks.

Only batches and invoices carry `invDate`, so the index is sparse — products, movements
and counters never appear in it.

> **Why not `GSI3`?** It is taken: the live table already has `GSI3-ClientName` (client
> name search, used by `clients.ts`), plus `GSI4-MobileDigits` and `GSI5-ReportSchedule`.
> The attribute naming also follows house style — per-user indexes key on `PK` + a real
> attribute name, not synthetic `GSI<n>PK`/`GSI<n>SK` pairs.

> **Infra note:** `infra/lib/biztrack-stack.ts` **is** the live stack (instantiated by
> `infra/bin/infra.ts`) — table, all GSIs, every Lambda and every API route are declared
> there. `infra/lib/infra-stack.ts` is unused `cdk init` scaffold. Adding the index is an
> ordinary code change deployed with `cdk deploy`; no console step, no fallback needed.
> Only constraint: CloudFormation permits one GSI addition per stack update, so ship
> `GSI6` on its own deploy before the handlers that query it.

---

## 5. REST API surface

Follow the routing style in `tasks.ts` (method + presence of `pathParameters.id`).
Register these routes in API Gateway the same way `tasks`/`clients` are registered.

### Products — `products` Lambda

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/products` | List products. Query params: `search`, `category`, `stockStatus`, `expiringInDays`, `sortBy`, `limit`, `nextToken` |
| `GET` | `/products/{id}` | Get one product |
| `POST` | `/products` | Create product |
| `PUT` | `/products/{id}` | Update product |
| `DELETE` | `/products/{id}` | Delete product (also deletes its movements, or leaves them as history — decide; blueprint keeps movements) |
| `POST` | `/products/bulk` | Bulk import (Excel) — body `{ products: Product[] }`, returns `{ imported, requested, failed, timedOut }` (copy `clientsApi.bulkAdd`) |
| `DELETE` | `/products/bulk` | Bulk delete — body `{ ids: string[] }` |

`expiringInDays=30` → server does a `GSI6-InventoryDate` range query
`invDate BETWEEN <today> AND <today+30d>` filtered with `begins_with(SK, 'BATCH#')`
(mirror `listTasksByDateRange`).

### Stock movements — `stockMovements` Lambda

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/stock-movements` | List movements (audit). Query params: `productId`, `type`, `from`, `to`, `limit`, `nextToken`. Newest-first (`ScanIndexForward:false`) |

> **The movements Lambda is READ-ONLY. There is no `POST /stock-movements`** — and no
> `stockApi.record()` on the client. Per the stock-flow rule (§1), the UI never creates
> movements. Movements are written server-side as a side effect: **`OUT`** by the invoice
> handler on sale, **`IN`** on purchase, **`ADJUST`** by a batch correction, and
> **`WRITE_OFF`** by the write-off action. The helper below is a shared internal function
> those handlers call — not an exposed route.

**Critical shared logic — `lambda/src/lib/stock.ts` (`applyStockChange`).** This is the one
piece of real business logic; it lives in `lib/`, **not** in the read-only
`stockMovements.ts` handler, and every stock-touching handler imports it. Keep it
server-side so quantity can never drift.

Stock lives on **batches**; the product row only caches roll-ups. So every operation
targets `BATCH#<productId>#<expiryDate>` and updates the product's cached
`totalQuantity` / `earliestExpiry` in the same transaction:

1. Resolve the target batch key from `(productId, expiryDate)`. Load the product
   (`GetCommand`, `keys.product(uid, productId)`); 404 if missing.
2. Compute the **batch** delta:
   - `IN` → `ADD quantity :q` on the batch (creates it if the expiry is new).
   - `OUT` / `WRITE_OFF` → `ADD quantity :-q` carrying
     `ConditionExpression: quantity >= :q`. The condition **is** the oversell guard —
     never read-then-check. A failure cancels the whole transaction → `409
     INSUFFICIENT_STOCK`.
   - `ADJUST` → set **that batch's** quantity absolutely (manual correction). If the
     expiry itself changed, the batch is re-keyed: delete the old item and create/merge at
     the new key in the same transaction.
3. Update the product roll-up in the same transaction: `totalQuantity` by the same delta,
   and `earliestExpiry` — on `IN` inline as `min(current, lineExpiry)`; on
   `OUT`/`WRITE_OFF`/`ADJUST` the minimum may move *later*, which needs a query, so
   recompute **after** the transaction (brief staleness only ever warns early).
4. Write the movement item in the same **`TransactWriteCommand`** so the audit record and
   the stock change land together or not at all.
5. Return `{ movement, batch, product }` so the client updates all three in one round-trip.

> **Aggregate before you build.** Multiple lines of one invoice may touch the same product
> at different expiries. Those are different batch items but the **same** product item, and
> DynamoDB rejects a transaction that addresses one item twice — sum the roll-up deltas per
> product first.

All handlers must call `resolveCors`, `getUid`, and `guardAccount(uid)` first —
copy the top of `tasks.ts::handler` verbatim.

---

## 6. Backend files to create (`lambda/src/`)

```
lambda/src/
  products.ts          # handler: list/get/add/update/delete/bulk (copy tasks.ts + clients.ts bulk)
  batches.ts           # handler: expiry range query, manual correction, write-off
  stockMovements.ts    # handler: LIST ONLY (read-only audit) — no POST
  lib/stock.ts         # NEW: applyStockChange() — builds the TransactWrite items (§5)
  lib/db.ts            # EDIT: add product + batch + stockMove key helpers (§4)
  lib/response.ts      # EDIT: add conflict() + code-carrying badRequest (API contract §0)
```

`products.ts` list logic:

- Default path: `QueryCommand` on base table, `KeyConditionExpression: PK = :pk`,
  `FilterExpression: begins_with(SK, :prefix)` with `:prefix = 'PRODUCT#'`,
  then apply `category`/`search`/`stockStatus` as filter expressions (same shape as `listTasks`).
- `expiringInDays` path: separate self-contained function querying `GSI6-InventoryDate`
  with a `BETWEEN` key condition on `invDate` (copy `listTasksByDateRange` structure
  exactly — its own KeyCondition / Filter / values, sharing no expression seed with the
  default list path).
- `stockStatus` (Low/Out) is derived from `totalQuantity` vs `reorderLevel`; DynamoDB can
  filter `totalQuantity <= reorderLevel` via `FilterExpression` (use
  `ExpressionAttributeNames` aliases such as `#qty` if any path collides with a reserved
  word).

---

## 7. Frontend service layer (`src/shared/services/apiService.ts`)

Add two typed API objects next to `clientsApi`/`tasksApi`. Follow the identical
shape (they all use the private `request<T>()` helper already in the file).

```ts
// ── Products ─────────────────────────────────────────────────────────────────
export interface ProductsResponse { products: Product[]; nextToken: string | null; count?: number; }
export interface ProductFilters {
  search?: string; category?: string; stockStatus?: string;
  expiringInDays?: number; sortBy?: string; limit?: number; nextToken?: string;
}
export const productsApi = {
  list:   (f: ProductFilters = {}) => request<ProductsResponse>(`products${qs(f)}`),
  get:    (id: string) => request<Product>(`products/${id}`),
  add:    (p: Product) => request<Product>('products', { method: 'POST', body: JSON.stringify(p) }),
  update: (p: Product) => request<Product>(`products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  delete: (id: string) => request<void>(`products/${id}`, { method: 'DELETE' }),
  bulkAdd:    (products: Product[]) => request<{ imported: number; requested: number; failed: number; timedOut: boolean }>('products/bulk', { method: 'POST', body: JSON.stringify({ products }) }),
  bulkDelete: (ids: string[]) => request<{ deleted: number; requested: number; timedOut: boolean }>('products/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
};

// ── Stock movements (read-only audit; movements are written server-side) ──────
export interface StockMovementsResponse { movements: StockMovement[]; nextToken: string | null; }
export interface StockMovementFilters { productId?: string; type?: string; from?: string; to?: string; limit?: number; nextToken?: string; }
export const stockApi = {
  list: (f: StockMovementFilters = {}) => request<StockMovementsResponse>(`stock-movements${qs(f)}`),
};
```

> **There is no `qs()` helper in the repo.** `clientsApi.list` builds its query string with
> an inline `URLSearchParams` block (`apiService.ts`), and every other `list` repeats that
> pattern. Either add a real shared `qs()` (and optionally retrofit the existing callers) or
> repeat the inline block — but do not import a helper that does not exist. The `qs(f)`
> shorthand above is pseudocode for whichever you choose.

---

## 8. Frontend feature module (`src/features/inventory/`)

Mirror the `clients` and `tasks` folders exactly:

```
src/features/inventory/
  pages/
    Inventory.tsx           # valuation summary (top) + batch detail table (below) + filters/search
    ProductDetail.tsx       # optional: one product, its batches + movement history (audit)
  components/
    InventoryValueCards.tsx # 3 metric cards: total stock value @50% · total VP in stock · total units
    ProductSummaryTable.tsx # per-product roll-up: name · qty · 50% price · value · VP + totals row
    BatchTable.tsx          # detail: one row per product-expiry (name · expiry · qty · value · VP · Edit · Write off)
    ProductModal.tsx        # add/edit CATALOGUE details (name, reorder level, prices) — not stock
    BatchModal.tsx          # edit a batch's qty/expiry (corrections); normal stock flow is via invoices
    WriteOffModal.tsx       # confirm write-off: shows qty + value removed, asks a reason
    ProductFilters.tsx      # category / stock-status / expiry filters (copy ClientFilters.tsx)
    StockMovementList.tsx   # read-only history log (audit) — shown in ProductDetail
    ExpiryBadge.tsx         # per-batch pill: Expired (red) / Expiring Soon (amber) / OK (muted)
    StockBadge.tsx          # product pill: In Stock / Low Stock / Out of Stock
    ImportPreviewModal.tsx  # Excel import preview (copy from clients/components)
  hooks/
    useInventory.ts         # products + batches; roll-ups; filters; copy useTasks.ts patterns
    useInventoryStats.ts    # valuation totals + low-stock + expiring-soon + expired counts
```

**Layout (design-reviewed):**
- **Top — valuation:** `InventoryValueCards` (total stock value @50%, total VP in stock,
  total units) + `ProductSummaryTable` (per product: qty · 50% price · value · VP, with a
  totals row).
- **Bottom — batch detail:** `BatchTable`, one row per product-expiry, sorted so the
  soonest expiry surfaces; batch-level `ExpiryBadge`. Row actions = Edit (corrections) and
  Write off (expired/damaged), the latter surfaced prominently on expired rows.
- **No Category column** (category stays a filter). No manual stock buttons.

> All normal stock changes flow through invoices (sale = pick a batch to deduct;
> purchase = add/merge a batch). `BatchModal` exists only for manual corrections; the
> movement log is read-only audit.

### `useInventory.ts`
Copy `useClients.ts` beat-for-beat (`versionRef` guard against stale responses, exhaust
every `nextToken` page into one array, client-side slicing for pagination, `refresh`,
mutators that patch local state or refresh). Swap `clientsApi` → `productsApi`,
`Client` → `Product`. Toasts are raised by the **page**, not the hook — match the existing
split.

### `useStockMovements.ts` — read-only
Exposes `movements`, `loading`, `error`, `refresh` and nothing else. **There is no
`record()`**, because there is no `POST /stock-movements` (§5). Movements appear because a
sale, purchase, correction or write-off wrote them server-side; after any of those, call
`refresh()` (or refetch the product) to pick them up.

### Derived helpers (`src/shared/utils/inventory.ts`)

Stock and expiry live on **batches**; the product carries only the cached roll-ups
`totalQuantity` and `earliestExpiry` (§3). There is no `product.quantity` and no
`product.expiryDate`.

```ts
export const getStockStatus = (p: Product): StockStatus =>
  p.totalQuantity <= 0 ? 'Out of Stock'
  : p.totalQuantity <= p.reorderLevel ? 'Low Stock'
  : 'In Stock';

// Per BATCH — the authoritative expiry check.
export const getExpiryStatus = (b: Batch, soonDays = 30): 'Expired' | 'Expiring Soon' | 'OK' => {
  const days = differenceInCalendarDays(new Date(b.expiryDate), new Date()); // date-fns is already a dependency
  return days < 0 ? 'Expired' : days <= soonDays ? 'Expiring Soon' : 'OK';
};

// Product-level badge rolls up from the cached earliest expiry.
export const getProductExpiryStatus = (p: Product, soonDays = 30) =>
  p.earliestExpiry
    ? getExpiryStatus({ expiryDate: p.earliestExpiry } as Batch, soonDays)
    : 'OK';
```
(`date-fns` is already installed — reuse it.)

---

## 9. Routing & navigation wiring

**`src/App.tsx`** — add inside the `<PrivateRoute />` group:
```tsx
import Inventory from './features/inventory/pages/Inventory';
// ...
<Route path="/inventory" element={<Inventory />} />
```

**`src/shared/components/layout/Sidebar.tsx`** — add to `navItems`:
```tsx
import { faBoxesStacked } from '@fortawesome/free-solid-svg-icons';
// ...
{ to: '/inventory', icon: faBoxesStacked, label: 'Inventory' },
```

**`src/shared/components/layout/MobileNav.tsx`** — add the matching mobile entry
(same `to`/`icon`/`label`).

---

## 10. Alerts

Two surfaces, reusing infrastructure that already exists.

### 10.1 In-app (dashboard)
Add inventory cards to the dashboard using `useInventoryStats.ts`:
- **Expiring soon** (count within 30d) — amber card, links to `/inventory?expiring=30`.
- **Expired** — red card, links to `/inventory?expiring=expired`.
- **Low stock** — count where `quantity <= reorderLevel`, links to `/inventory?stock=low`.

The dashboard already aggregates counts server-side (`dashboardApi` → `dashboard.ts`).
Extend `DashboardResponse.counts` with `expiringSoon`, `expired`, `lowStock` and
compute them in `lambda/src/dashboard.ts` (query `GSI6-InventoryDate` for expiry;
query `PRODUCT#` for low-stock). Keeps a single dashboard round-trip.

> **Watch the cost.** `dashboard.ts` already runs 6 parallel queries and `/dashboard/GET`
> is throttled to 5 rps / 10 burst — it is called out in the stack as the most expensive
> read. These additions take it to ~9, and `stockValue`/`vpInStock` need every product row.
> Consider caching the valuation on the profile item the way `clientCount` is cached in
> `clients.ts`.

### 10.2 Scheduled (WhatsApp report)
Biztrack already has `lambda/src/whatsappScheduler.ts` and a per-user daily report
(`User.reportGenerationTime` / `reportEnabled` / `timezone`). Extend the report
builder to include an **"Inventory alerts"** section:
- products expiring within N days (list name + date + qty)
- products at/below reorder level

No new scheduling infra — just add the section to the existing report payload.
Gate it behind a user setting (e.g. `inventoryAlertsEnabled`, `expiryAlertDays`)
added to the `User` type + Profile page.

> **WhatsApp only (D5).** Earlier drafts said "WhatsApp + email". There is no email
> pipeline in this app — `whatsappScheduler.ts` posts to the Meta Graph API and there is no
> SES client or mail transport anywhere in `lambda/`. Email would be a new provider; it is
> out of scope for v1.

---

## 11. Future option — FEFO auto-deduction

Batch/lot tracking is **already the v1 model** (§1, §3; PRD §6 decision 5) — this section
previously described it as a future upgrade, which is stale. What remains deferred is
automatic batch selection:

- **v1:** on a sale line the user **picks the batch (expiry)** to sell from.
- **Later:** first-expiry-first-out — the server consumes the earliest-expiring batch
  automatically, spilling into the next batch when one runs short (so a single line can
  span batches, and one line may produce several `OUT` movements).

Nothing needs to change structurally to get there: batches, the movement log and
`earliestExpiry` are already in place. The sale line just stops carrying a user-chosen
`expiryDate` and starts carrying a server-computed batch allocation.

---

## 12. Testing & verification

Test tooling as it actually stands: Vitest is configured for the frontend
(`vite.config.ts`, `environment: 'node'`) but **`src/` has zero test files today**; `infra/`
has a working Jest setup; **`lambda/` has no test runner at all** (its `test` script just
exits 1). Per **D3**, add Vitest to `lambda/` in Phase 2. Component tests would also need
`jsdom` + `@testing-library/react` — neither is installed, so keep v1 tests to pure logic.

- **Unit (frontend):** `getStockStatus` / `getExpiryStatus` boundaries (0 qty,
  qty == reorderLevel, expiry today, expiry yesterday).
- **Backend logic (`lambda/`, Vitest):** `lib/stock.ts` **item construction** as a pure
  function — assert the `TransactWrite` item list for IN / OUT / ADJUST / WRITE_OFF, that
  every decrement carries `ConditionExpression: quantity >= :q`, and that per-product
  roll-up deltas are aggregated so no item is addressed twice.
- **Import:** malformed Excel rows are reported, not silently dropped (reuse the Clients import guarantees).
- **Manual smoke:** add product → stock in (updates qty + expiry) → stock out → see movement log → low-stock badge appears → expiring-soon badge appears → dashboard counts match.

---

## 13. Phased build plan for Claude Code

Build in this order — each phase is independently testable.

**Phase 1 — Types & derived helpers**
- Add `Product`, `Batch`, `StockMovement`, enums to `src/shared/types/index.ts`.
- Create `src/shared/utils/inventory.ts` (`getStockStatus`, `getExpiryStatus`, valuation roll-ups) + unit tests.

**Phase 2 — Backend: products + batches**
- Add product/batch/stockMove key helpers to `lambda/src/lib/db.ts`.
- Add `conflict()` + code-carrying `badRequest` to `lambda/src/lib/response.ts`.
- Create `lambda/src/lib/stock.ts` — the shared `applyStockChange` that mutates a batch
  (`BATCH#product#expiry`) and the product's cached `totalQuantity`/`earliestExpiry` in one
  `TransactWrite` — plus `lambda/src/products.ts` and `lambda/src/batches.ts`.
- Add `GSI6-InventoryDate` to the table in `infra/lib/biztrack-stack.ts` and `cdk deploy`
  it on its own (one GSI per stack update).
- Stand up Vitest in `lambda/` and test `lib/stock.ts` item construction (D3).

**Phase 3 — Frontend: inventory page**
- `productsApi` (+ batches) in `apiService.ts`; `useInventory.ts`, `useInventoryStats.ts`.
- `Inventory.tsx` = `InventoryValueCards` + `ProductSummaryTable` + `BatchTable`;
  `ProductModal`, `BatchModal`, `ProductFilters`, `ExpiryBadge`, `StockBadge`.
- Route + Sidebar/MobileNav links.

**Phase 4 — Movement log (audit)**
- `lambda/src/stockMovements.ts` (list only) + route; `stockApi.list`; `StockMovementList`.
- (Movements are written by `applyStockChange`, invoked from invoices — not a manual screen.)

**Phase 5 — Alerts**
- Extend `dashboard.ts` counts + dashboard cards.
- `useInventoryStats.ts`.
- Add inventory section to the WhatsApp report + user settings.

**Phase 6 — Excel import/export & bulk**
- `products/bulk` endpoints; `ImportPreviewModal` (copy from clients); export via existing `exceljs` dependency.
- **`parseExcel` needs a header-spec parameter first.** Today it hardcodes *client* header
  detection — it scans the first 20 rows for a name-like **and** a mobile-like column
  (`requiredName` / `requiredMobile` in `src/shared/utils/excelUtils.ts`) and silently falls
  back to row 0 when it finds neither. A product sheet never matches, so it only works by
  accident when the header happens to sit on row 0 (as it does in
  `herbalife_products_seed.csv`) and breaks on any sheet with a title row above the header.
  Pass the required-column synonyms in, and add `validateProductRow` +
  `exportProductsToExcel` alongside the client equivalents.

**Phase 7 — Polish & test**
- Empty states, loading skeletons, negative-stock guards, verification checklist (§12).

---

## 14. Open decisions to confirm before/while building

1. **Negative stock:** reject an OUT that exceeds quantity, or allow (backorder)? *(blueprint: reject)*
2. **Delete product:** keep or purge its movement history? *(blueprint: keep history)*
3. **Expiry window:** default "expiring soon" = 30 days? Make it a user setting?
4. **Units/currency:** single currency assumed (matches app); confirm supplement units list.
5. ~~**GSI vs fallback**~~ — **settled (D1/C2):** the table and its indexes are defined in
   `infra/lib/biztrack-stack.ts` in this repo. Add `GSI6-InventoryDate` there and deploy
   with `cdk deploy`. No fallback needed.

