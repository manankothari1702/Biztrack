# Biztrack — Invoices Feature Blueprint (Sales & Purchases)

> Build spec for creating **sale** invoices (sell to customers) and **purchase**
> invoices (restock for yourself) from the Herbalife supplement catalogue.
> Extends the Inventory feature (see `INVENTORY_FEATURE_BLUEPRINT.md`). Hand this to
> Claude Code and build phase by phase.

**Corrections applied 2026-07-22** (see `docs/specs/07_BUILD_PLAN.md` §3):
C7/D1 — invoice `SK = INVOICE#<id>` (point reads + idempotency); newest-first ordering
moves to the shared `GSI6-InventoryDate` index (`invDate = createdAt`).
C3 — stock/movement writes live in `lambda/src/lib/stock.ts`, not in `stockMovements.ts`;
there is no `qs()` helper; product roll-up fields are `totalQuantity`/`earliestExpiry`.
C4 — errors use `{ error: CODE, message }`; `conflict()` is a new helper.
D2 — PDF is `window.print()`. D6 — the counter stores `{ seq, year }` and resets yearly.

---

## 1. Goal

One **Invoices** area with two document types that share a single builder:

- **Sale** — sell to a customer. Pick a discount tier; deducts stock. Customer-facing (printable).
- **Purchase (restock)** — buy for yourself. Locked to 50% (your cost); adds stock and sets expiry per line. Internal record.

They are symmetric: a Sale takes stock **out**, a Purchase puts stock **in**. "Billed to"
(customer) on a Sale becomes "Bought from" (supplier) on a Purchase.

> **Stock is tracked in batches** (product + one expiry date + quantity — see
> `INVENTORY_FEATURE_BLUEPRINT.md`). Invoices move stock at the batch level.

### Sale invoice
- **One discount tier for the whole invoice** (0% / 25% / 35% / 42% / 50%) — chosen once; every line uses it.
- Each line: **product + batch (pick which expiry you're selling from) + quantity** →
  **per-piece VP · total VP · rate · amount**. The batch dropdown lists that product's
  available expiries with qty-on-hand; the chosen batch is what gets decremented.
- **Customer details + auto invoice number (INV-) + date.**
- **Deducts from the selected batch** (writes an `OUT` movement).
- **PDF / print export.** Cost/profit never shown (customer bill).

### Purchase invoice (restock)
- **Buy price locked at 50%** (`price50`) — the rate column is your cost. (Editable only if you sometimes buy at another tier.)
- Each line: **product + quantity + expiry date** → **total VP earned · rate (50%) · amount**.
- **Supplier ("Bought from") + auto purchase number (PUR-) + date.**
- **Adds to the matching batch or creates a new one** (writes an `IN` movement): same
  expiry merges into the existing batch, a new expiry becomes a new batch/row.
- No PDF needed (not shared); optional.
- **Total VP earned** is prominent — in Herbalife, VP accrues when *you* buy.

### Pricing rules (from the price list, effective 2026-04-15)

Each product carries these price points (see seed data in `docs/inventory/`):

| Field | Meaning | Example — Formula 1 Strawberry (1239) |
|-------|---------|----------------------------------------|
| `vp` | Volume Points **per piece** (constant, tier-independent) | 21.75 |
| `retail` | **0% price** — customer pays full retail | 2075 |
| `price25` | 25% tier | 1713 |
| `price35` | 35% tier | 1526 |
| `price42` | 42% tier | 1396 |
| `price50` | 50% tier = user's **cost** (default buy) | 1246 |
| `mrp` | reference only (not used for selling) | 2179 |

**Discount tier → unit price:** `0 → retail`, `25 → price25`, `35 → price35`,
`42 → price42`, `50 → price50`.

**Line amount** = `unitPriceAtTier × quantity`.
**Line VP** = `product.vp × quantity` (VP does **not** change with discount).
**Invoice total amount** = Σ line amounts. **Invoice total VP** = Σ line VP.

> Internal-only: `cost = price50 × qty`. Store it on the invoice record if you want
> internal profit reporting later, but **never render it on the printable invoice**.

---

## 2. Seed data (already extracted)

The full catalogue is in `docs/inventory/`:

- `herbalife_products_seed.csv` — 57 products, columns:
  `stockNo, name, category, vp, mrp, retail, price25, price35, price42, price50, cost50, priceSource, notes`
- `herbalife_products_seed.json` — same data + metadata (`priceTiers`, `defaultBuyTier`)
- `herbalife_products_seed.xlsx` — spreadsheet version

(Earn Base was intentionally omitted — it's a back-office stock figure, not needed for
selling/invoicing. Add it back in a future revision if the software starts using it.)

**Grouped pricing:** where the price list printed one price line for a family of
flavours (e.g. all Formula 1 500g variants), every variant was given that shared
price; `priceSource` records whether a row was printed directly (`own`) or inherited
(`grouped-*`). Data is fully reconciled — **no rows require verification.** Confirmed
during review: `529K` Dates Caramel is an F1 500g flavour; `230K` Kashmiri Kahwa uses
the same price/VP as Lemon (the standard 50g line), not Tulsi.

This seed feeds the **Inventory `Product` catalogue**. Invoicing reads products from
the same store — so build/seed Inventory first (or seed a lightweight product table).

---

## 3. Relationship to Inventory

Invoicing depends on the `Product` entity defined in `INVENTORY_FEATURE_BLUEPRINT.md`.
Two additions to that `Product` type make invoicing clean — add these fields:

```ts
export interface Product {
  // ...existing fields (id, name, category, totalQuantity, earliestExpiry, ...)
  // NB: stock and expiry live on BATCHES; the product carries only cached roll-ups.
  // There is no product.quantity and no product.expiryDate.
  vp: number;            // volume points per piece
  retail: number;        // 0% price
  price25: number;
  price35: number;
  price42: number;
  price50: number;       // = cost / default buy price
  stockNo?: string;      // Herbalife stock no. (e.g. "1239", "127K")
}
```

`sellPrice`/`costPrice` from the Inventory blueprint become derived: `costPrice = price50`.

If you are not building full Inventory yet, you can still ship invoicing against a
minimal read-only product catalogue seeded from `herbalife_products_seed.json`.

---

## 4. Data model (new types)

Add to `src/shared/types/index.ts` and mirror in the Lambda.

```ts
export type DiscountTier = 0 | 25 | 35 | 42 | 50;
export type InvoiceType = 'SALE' | 'PURCHASE';

export interface InvoiceLine {
  productId: string;        // Product.id
  stockNo?: string;         // snapshot for the printed bill
  name: string;             // snapshot (so historical invoices don't change if product renamed)
  unitPrice: number;        // snapshot of price at the invoice tier at time of the transaction
  unitVp: number;           // snapshot of product.vp (per piece)
  quantity: number;
  lineAmount: number;       // unitPrice * quantity
  lineVp: number;           // unitVp * quantity
  expiryDate: string;       // the BATCH this line touches — SALE: batch sold from; PURCHASE: shipment expiry
  // internal only — omit from a printable SALE bill:
  unitCost?: number;        // = product.price50 (50% cost)
}

export type InvoiceStatus = 'Draft' | 'Finalized' | 'Cancelled';

export interface Invoice {
  id: string;
  type: InvoiceType;        // 'SALE' or 'PURCHASE'
  invoiceNo: string;        // "INV-2026-0001" for sales, "PUR-2026-0007" for purchases
  date: string;             // ISO
  tier: DiscountTier;       // SALE: chosen tier. PURCHASE: always 50
  // party — customer for a SALE, supplier for a PURCHASE (one pair used per type):
  partyName: string;        // customer name  OR  supplier ("Bought from")
  partyPhone?: string;
  partyEmail?: string;
  partyAddress?: string;
  lines: InvoiceLine[];
  totalAmount: number;      // Σ lineAmount (SALE: sale total; PURCHASE: cost total)
  totalVp: number;          // Σ lineVp  (PURCHASE: VP earned)
  totalCost?: number;       // SALE internal Σ unitCost*qty — never printed
  status: InvoiceStatus;
  stockApplied: boolean;    // true once stock was moved (OUT for sale, IN for purchase)
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}
```

> **Snapshot rule:** copy `name`, `unitPrice`, `unitVp` onto each line at save time.
> Prices change (new price lists); a saved invoice must never mutate afterward.

---

## 5. DynamoDB design (single-table — reuse `biztrack`)

Add key helpers to `lambda/src/lib/db.ts`:

```ts
invoice:    (uid, id)     => ({ PK: `USER#${uid}`, SK: `INVOICE#${id}` }),
counterSale:(uid)         => ({ PK: `USER#${uid}`, SK: 'COUNTER#SALE' }),
counterPur: (uid)         => ({ PK: `USER#${uid}`, SK: 'COUNTER#PURCHASE' }),
```

- **Invoice item:** `PK = USER#<uid>`, `SK = INVOICE#<id>` — the **client-generated id
  alone**, whole invoice with lines embedded. `type` (`SALE`/`PURCHASE`) is an attribute;
  both types share the `INVOICE#` prefix so one list query returns everything, then filter
  by `type` for the active tab.

  > **Why not `INVOICE#<createdAt>#<id>` (C7)?** An earlier draft of this section proposed
  > that for native chronological ordering, contradicting the key helper directly above it.
  > It breaks two things: (1) **point reads** — `GET /invoices/{id}`, `finalize`, `cancel`
  > and `DELETE` all address an invoice by id alone, with no `createdAt` to build the key
  > from; and (2) **idempotency** — the duplicate-submit guard is
  > `attribute_not_exists(PK)` keyed on the client-generated id, but `createdAt` is
  > server-assigned, so a retry would compute a *different* key and the guard would never
  > fire. Id-only SK restores both.

- **Numbering — two counters:** sales use `COUNTER#SALE` → `INV-<year>-<seq>`; purchases
  use `COUNTER#PURCHASE` → `PUR-<year>-<seq>`. The counter item holds `{ seq, year }`.
  Increment atomically (`ADD seq :1`, `ReturnValues: UPDATED_NEW`) conditional on
  `year = :thisYear`; if that condition fails the year has rolled, so write
  `{ seq: 1, year: :thisYear }` and use `1` (**D6** — yearly reset). Numbers never collide
  under concurrent saves. The counter is bumped **before** the transaction, so a failed
  transaction burns a number — gaps are acceptable by design.

- **Listing newest-first:** invoices write `invDate = createdAt` and are listed from the
  shared **`GSI6-InventoryDate`** index (`PK` + `invDate`), `ScanIndexForward: false`,
  filtered with `begins_with(SK, 'INVOICE#')`.

No *dedicated* GSI is required — invoices ride the same index the Inventory feature adds
for batch expiry (Inventory blueprint §4, Data Model §7).

---

## 6. REST API surface

New `invoices` Lambda (copy the routing skeleton from `lambda/src/tasks.ts`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/invoices` | List (params: `type`=SALE\|PURCHASE, `from`, `to`, `status`, `limit`, `nextToken`), newest-first |
| `GET` | `/invoices/{id}` | Get one |
| `POST` | `/invoices` | Create (SALE or PURCHASE). **Server** assigns the number, recomputes totals, and — if `finalize:true` — applies stock |
| `PUT` | `/invoices/{id}` | Update a **Draft** only (finalized invoices are immutable; use cancel) |
| `POST` | `/invoices/{id}/cancel` | Set `status=Cancelled`; reverse the stock change |
| `DELETE` | `/invoices/{id}` | Delete a Draft |

### Server responsibilities on `POST /invoices` (the real logic)

1. `resolveCors` / `getUid` / `guardAccount` (copy `tasks.ts` header).
2. For each line: **re-read the product**. Recompute `unitPrice`:
   `SALE` → from the invoice's chosen `tier`; `PURCHASE` → from `price50` (tier forced to 50).
   Snapshot `unitVp`; compute `lineAmount`/`lineVp`. **Never trust client-sent prices.**
3. Recompute `totalAmount`, `totalVp` (SALE: also internal `totalCost`).
4. Assign the number from the matching counter (`INV-` for SALE, `PUR-` for PURCHASE),
   resetting the sequence if the stored `year` is not the current year (§5).
5. If finalizing, apply stock atomically via the shared `applyStockChange` helper in
   **`lambda/src/lib/stock.ts`** (`TransactWriteCommand` — invoice + every batch update +
   movement together):
   - **SALE:** for each line, decrement the batch `BATCH#<productId>#<line.expiryDate>`
     and the product's cached `totalQuantity`; write an `OUT` movement
     (`reason:'Sale — <invoiceNo>'`). Reject the whole invoice if any line exceeds that
     batch's quantity (no oversell). Recompute the product's `earliestExpiry`.
   - **PURCHASE:** for each line, `ADD` to `BATCH#<productId>#<line.expiryDate>` (creates
     it if absent) and the product's `totalQuantity`; write an `IN` movement
     (`reason:'Purchase — <invoiceNo>'`); refresh `earliestExpiry`.
6. Return the saved invoice.

---

## 7. Backend files

```
lambda/src/
  invoices.ts        # NEW handler (list/get/create/update/finalize/cancel/delete + numbering + stock deduct)
  lib/stock.ts       # EDIT (created in Inventory Phase 2): multi-line transactions + reversal
  lib/db.ts          # EDIT: add invoice + counter key helpers
  lib/response.ts    # EDIT: conflict() + code-carrying badRequest (API contract §0)
```

Reuse from Inventory: **`lib/stock.ts`** — it owns `applyStockChange` and every movement
write. Do **not** import from `stockMovements.ts`, which is a read-only list handler with
no writer in it, and do not duplicate the helper. Reuse `lib/response.ts`,
`lib/accountGuard.ts`, `lib/sanitize.ts` exactly as the other handlers do.

> **Aggregate roll-up deltas before building the transaction.** Two lines of the same
> product at different expiries hit two batch items but the **same** product item, and
> DynamoDB rejects a transaction that addresses one item twice.

---

## 8. Frontend service layer (`src/shared/services/apiService.ts`)

```ts
export interface InvoicesResponse { invoices: Invoice[]; nextToken: string | null; }
export interface InvoiceFilters { type?: 'SALE' | 'PURCHASE'; from?: string; to?: string; status?: string; limit?: number; nextToken?: string; }

export const invoicesApi = {
  list:   (f: InvoiceFilters = {}) => request<InvoicesResponse>(`invoices${qs(f)}`),
  get:    (id: string) => request<Invoice>(`invoices/${id}`),
  create: (inv: Invoice, finalize = true) =>
            request<Invoice>(`invoices?finalize=${finalize}`, { method: 'POST', body: JSON.stringify(inv) }),
  update: (inv: Invoice) => request<Invoice>(`invoices/${inv.id}`, { method: 'PUT', body: JSON.stringify(inv) }),
  finalize: (id: string) => request<Invoice>(`invoices/${id}/finalize`, { method: 'POST' }),
  cancel: (id: string) => request<Invoice>(`invoices/${id}/cancel`, { method: 'POST' }),
  delete: (id: string) => request<void>(`invoices/${id}`, { method: 'DELETE' }),
};
```

> **`qs()` does not exist.** `clientsApi.list` builds its query string with an inline
> `URLSearchParams` block and every other `list` repeats it. Either add a real shared
> helper or inline the block — just don't import one that isn't there.

> **Errors carry codes.** `request<T>()` throws `ApiError(status, message, code)` where
> `code = body.error`. The builder branches on `INSUFFICIENT_STOCK` (highlight the line,
> show `available`) and treats `DUPLICATE` as success (fetch and show). That requires the
> new server-side helpers in `05_API_CONTRACT` §0.

---

## 9. Frontend feature module (`src/features/invoices/`)

```
src/features/invoices/
  pages/
    Invoices.tsx            # ONE page with two tabs: Sales | Purchases (filtered list)
    InvoiceBuilder.tsx      # shared create/edit screen; takes a `type` (SALE | PURCHASE)
    InvoiceView.tsx         # read-only invoice (printable for SALE)
  components/
    InvoiceLineRow.tsx      # product picker + qty; SALE shows VP·totalVP·rate·amount, PURCHASE adds an expiry-date field
    ProductPicker.tsx       # searchable product select (name / stockNo) — reads products catalogue
    TierSelect.tsx          # 0/25/35/42/50 — shown for SALE only; PURCHASE is locked to 50%
    PartyFields.tsx         # SALE: "Billed to" (customer). PURCHASE: "Bought from" (supplier)
    InvoiceTotals.tsx       # footer: total amount (+ "VP earned" label on purchases)
    InvoicePrint.tsx        # SALE print/PDF layout (no cost/profit shown)
  hooks/
    useInvoices.ts          # list (by type) + create/cancel/delete (copy useTasks.ts patterns)
    useProductCatalogue.ts  # load products once for the picker (from productsApi or seed)
```

### `InvoiceBuilder.tsx` behaviour — driven by `type`
**Shared:** pick product (search by name/`stockNo`) + qty per line; live totals; save →
`invoicesApi.create(invoice, finalize=true)` → server recomputes + applies stock; toasts
via `ToastContext`; optimistic patterns per `useTasks.ts`.

- **SALE:** one `TierSelect` at top (default 0% retail) re-prices all lines; "Billed to"
  customer fields; each row = product → **batch (expiry) picker** → qty → VP · total VP ·
  rate · amount; save → `InvoiceView` with Print. The batch picker lists the product's
  available expiries with qty-on-hand and blocks selling more than that batch holds.
- **PURCHASE:** tier locked to **50%** (no selector); "Bought from" supplier field; each
  row adds an **expiry-date** input; totals labelled **"Total VP earned"** and **"Total
  cost"**; save adds to stock and applies the earliest-expiry rule. No print needed.

---

## 10. PDF / print export

**Settled (D2): print-friendly HTML.** `InvoicePrint.tsx` renders a clean bill and a
"Print / Save as PDF" button calls `window.print()`; a `@media print` block in
`src/index.css` hides the app chrome. Zero new dependencies — the browser's own
"Save as PDF" produces the file.

`jspdf` / `jspdf-autotable` were the alternative and are **not** being added. Revisit only
if pixel-exact output or server-side generation becomes a requirement.

**The printed invoice must show:** business/associate name, invoice no. + date,
customer details, table of `name × qty × unit price × line amount`, **total amount**,
**total VP**, notes. **Must NOT show:** `price50`/cost/profit or the 50% buy basis.

---

## 11. Routing & navigation

- `src/App.tsx` — inside `<PrivateRoute />`:
  ```tsx
  <Route path="/invoices" element={<Invoices />} />          {/* Sales | Purchases tabs */}
  <Route path="/invoices/new/:type" element={<InvoiceBuilder />} />  {/* type = sale | purchase */}
  <Route path="/invoices/:id" element={<InvoiceView />} />
  ```
- `Sidebar.tsx` + `MobileNav.tsx` — add `{ to:'/invoices', icon: faFileInvoiceDollar, label:'Invoices' }`.
  The Sales/Purchases split lives as **tabs inside the Invoices page**, not as two nav items.

---

## 12. Open decisions to confirm

1. **Oversell (SALE):** block an invoice when stock is insufficient, or allow negative stock? *(blueprint: block)*
2. **Cancel reverses stock?** SALE cancel restores stock (IN); PURCHASE cancel removes it (OUT). *(blueprint: yes, reverse)*
3. **Draft vs finalize:** allow saving drafts (no stock change) before finalizing? *(blueprint: yes — `finalize` flag)*
4. ~~**Number format / yearly reset**~~ — **settled (D6):** `INV-<year>-<4-digit seq>` /
   `PUR-<year>-<seq>`, counter holds `{ seq, year }` and resets each January (§5).
5. **GST / tax line:** prices are GST-inclusive per the price list. *(blueprint: show "Prices inclusive of GST" note, no breakup)*
6. ~~**PDF approach (SALE only)**~~ — **settled (D2):** `window.print()` + a print
   stylesheet. No `jspdf` (§10).
7. **CONFIRMED — one tier per SALE:** a single discount applies to every line; mixed-discount orders = two invoices.
8. **CONFIRMED — restock is a PURCHASE invoice:** stock-in comes only from purchases (and Excel import); tier locked to 50%; per-line expiry adds/merges a batch.
9. **CONFIRMED — batch tracking:** stock is tracked per batch (product + expiry). On a SALE the user **picks the batch (expiry) to sell from**; no automatic FEFO for now.
10. **CONFIRMED — one Invoices area, Sales/Purchases tabs**, shared builder.

---

## 13. Phased build plan for Claude Code

**Phase 1 — Catalogue** — seed products from `docs/inventory/herbalife_products_seed.json`
(via the Inventory `products/bulk` import, or a one-off seed). Verify the 3 flagged rows.

**Phase 2 — Types & pricing helpers** — add `Invoice`, `InvoiceLine`, `DiscountTier`,
`InvoiceType`; a `priceForTier(product, tier)` util + unit tests (0→retail … 50→price50; VP tier-independent).

**Phase 3 — Backend** — `invoices.ts` (CRUD + finalize/cancel), two atomic
`{ seq, year }` counters, server-side total recomputation, `TransactWrite` applying stock
via `lib/stock.ts` (`OUT` for SALE, `IN` + earliest-expiry for PURCHASE). Invoices write
`invDate = createdAt` for `GSI6` ordering.

**Phase 4 — SALE builder** — `InvoiceBuilder` (sale mode), `InvoiceLineRow`, `ProductPicker`,
`TierSelect`, `PartyFields`, `InvoiceTotals`; `useInvoices`, `useProductCatalogue`.

**Phase 5 — Sale view, list & print** — `Invoices` list (Sales tab), `InvoiceView`,
`InvoicePrint` (cost/profit hidden), routing + nav.

**Phase 6 — PURCHASE mode** — same builder in purchase mode: locked 50%, "Bought from"
field, per-line expiry input, "VP earned"/"cost" totals; Purchases tab in the list.

**Phase 7 — Stock integration & polish** — finalize applies stock; cancel reverses;
empty/loading states; verification (totals math, VP totals, number uniqueness, earliest-expiry
on restock, no cost leak on printed sale).

---

## 14. Worked example (sanity check)

Invoice **discount tier = 25%** (one tier, all lines). Columns: Qty · VP · Total VP · Rate · Amount.

| Item | Qty | VP | Total VP | Rate (25%) | Amount |
|------|-----|----|----------|-----------|--------|
| Formula 1 Strawberry 500g (1239) | 2 | 21.75 | 43.50 | 1713 | 3426 |
| Woman's Choice (127K) | 1 | 12.45 | 12.45 | 978 | 978 |
| Afresh Lemon 50g (1295) | 3 | 7.80 | 23.40 | 638 | 1914 |
| Personalized Protein Powder 200g (1233) | 1 | 11.50 | 11.50 | 1018 | 1018 |

**Total amount = 3426 + 978 + 1914 + 1018 = 7336. Total VP = 90.85. Items = 7.**
Internal cost (hidden) = 2×1246 + 1×712 + 3×464 + 1×741 = **5381** — never printed.

> `Rate` comes from each product's `price25` column because the invoice tier is 25%.
> VP is tier-independent. If the tier were 50%, every rate would switch to the `price50`
> column in one step.

### Purchase (restock) example — tier locked at 50%. Columns: Qty · Expiry · Total VP · Rate · Amount.

| Item | Qty | Expiry | Total VP | Rate (50%) | Amount |
|------|-----|--------|----------|-----------|--------|
| Formula 1 Strawberry 500g (1239) | 12 | 30 Jun 2027 | 261.00 | 1246 | 14,952 |
| Woman's Choice (127K) | 6 | 15 Mar 2027 | 74.70 | 712 | 4,272 |
| Afresh Lemon 50g (1295) | 10 | 20 Jan 2027 | 78.00 | 464 | 4,640 |

**Total cost = ₹23,864. Total VP earned = 413.70. Items = 28.**
Effect on save: +12 / +6 / +10 units to stock; each product's expiry set to the earliest of
its current value and the shipment date above.
