# PRD — Biztrack Inventory & Invoicing

**Product:** Biztrack (business-management app for a Herbalife independent associate)
**Feature area:** Stock Inventory + Sales/Purchase Invoicing
**Version:** v1
**Status:** Approved for build
**Last updated:** 2026-07-19
**Corrections applied 2026-07-22:** resolves D4 (`ProductCategory` comes from the seed
file's 15 categories, §7), D5 (WhatsApp only — no email report exists, §4.6), and closes
open questions 1 and 2 in §8 via D6 and D2.

---

## 1. Problem statement

The user runs a "shop-in-shop" selling health supplements (Herbalife). Today there is
no way inside Biztrack to know **what stock is on hand, what it's worth, or what's about
to expire**, and no way to **bill customers** or **record purchases**. Supplements carry
expiry dates and are bought in batches at different times, so stock that expires unsold is
a direct loss. The user needs to:

- see current stock, its value, and expiry risk at a glance;
- create customer bills quickly at the correct discount price;
- record their own purchases (restocks) so stock and expiry stay accurate.

## 2. Target users

- **Primary:** the account owner — a Herbalife associate/supervisor who buys product at a
  50% distributor discount and resells to customers at retail or a smaller discount.
- **Usage context:** mostly desktop, some mobile; single user per account (data is
  isolated per user, matching Biztrack's existing model).

## 3. Goals & success metrics

| Goal | Metric |
|------|--------|
| Know stock at a glance | User can see total stock value (@50%) and total VP in stock on one screen |
| Prevent expiry loss | Expiring-soon (≤30d) and expired items surfaced on dashboard + daily report |
| Fast, correct billing | Create a sale invoice in < 60s; prices always match the current price list |
| Accurate stock | Every sale/purchase adjusts stock automatically; on-hand count never drifts |
| No manual reconciliation | Zero manual "stock in/out" entry needed in normal use |

## 4. Core features (v1)

1. **Inventory / valuation view**
   - Top summary: total stock value at 50% cost, total VP in stock, total units.
   - Per-product roll-up: quantity, 50% price, item value, VP.
   - Batch detail table: one row per product + expiry, with expiry badges.
2. **Batch tracking**
   - A product's stock is the sum of its batches; each batch has one expiry date.
   - Same-expiry restock merges; different expiry creates a new batch row.
3. **Sale invoice** (customer-facing)
   - One discount tier per invoice (0/25/35/42/50%); every line uses it.
   - Line = product → pick batch (expiry) → quantity → auto rate, amount, VP.
   - Customer details, auto invoice number, totals (amount + VP), print/PDF.
   - Deducts stock from the chosen batch. Cost/profit never shown on the bill.
4. **Purchase invoice** (restock, internal)
   - Locked to 50% (your cost); "Bought from" supplier.
   - Line = product + quantity + expiry → adds/merges a batch.
   - Totals: total cost + total VP earned.
5. **Write-off expired/damaged stock**
   - A batch row action to write off remaining units (reason: expired/damaged), so expired
     stock stops counting in valuation. Without this, expired batches inflate stock value forever.
6. **Alerts**
   - Dashboard cards + the existing **WhatsApp** daily report: expiring-soon, expired,
     low-stock. (WhatsApp only — the app has no email pipeline; see TRD §4.)
7. **Excel import/export**
   - Bulk import products (and opening stock) from the seed spreadsheet; export catalogue.
   - Re-importing an existing `stockNo` **updates** that product (upsert), never duplicates.
8. **Catalogue seed**
   - 57 Herbalife products with VP and all price tiers, pre-extracted (`docs/inventory/`).

## 5. Explicitly out of scope for v1 (later)

- **FEFO auto-deduction** — v1 has the user pick the batch by expiry at sale time; automatic
  earliest-first is a later enhancement.
- **Profit / margin reporting** — cost is tracked internally but no profit dashboards in v1.
- **Multi-user / staff roles** — single user per account, as today.
- **Monthly VP summary / Herbalife volume reports** — data is captured; reporting is later.
- **Barcode scanning, supplier catalogues, payments/खाता (ledger), GST filing exports.**
- **Returns / RMA** — cancel-invoice reverses stock; a full returns flow is later.
- **Offline-first** — relies on existing online sync/polling.

## 6. Key decisions (locked)

| # | Decision |
|---|----------|
| 1 | 0% price = the Retail Price column (not MRP). |
| 2 | One discount tier per sale invoice — no mixed-tier lines (mixed order = two invoices). |
| 3 | Stock changes only via invoices; no manual stock in/out buttons. |
| 4 | Restock is a Purchase invoice; stock-in also via Excel import. |
| 5 | Full batch tracking — stock per (product, expiry). |
| 6 | On sale, user picks the batch (expiry) to sell from; no auto-FEFO in v1. |
| 7 | One "Invoices" area with Sales / Purchases tabs, shared builder. |
| 8 | Inventory page = valuation summary (top) + batch detail (below). |
| 9 | Cost/profit never printed on a customer sale invoice. |
| 10 | Expired stock stays in valuation **until written off**; write-off is a first-class v1 action. |
| 11 | Max **30 lines per invoice** (DynamoDB transaction limit — see TRD §5). Longer orders = split invoices. |

## 7. Assumptions & dependencies

- Prices are GST-inclusive (per the price list); no GST breakup shown in v1.
- Single currency (INR).
- Depends on the existing Biztrack auth (Cognito), API, and DynamoDB table.
- Price list effective 2026-04-15; prices are snapshotted onto invoices so historical
  documents never change when the catalogue is updated.
- **Product categories come from the seed file** (D4). `ProductCategory` is the 15 values
  present in `docs/inventory/herbalife_products_seed.csv`, plus `'Other'`:

  > Bone & Joint Health · Brain Health · Cardiovascular Health · Children's Health ·
  > Digestive Health · Energy · Enhancers · Eye Health · Immune Health · Men's Health ·
  > Skin & Body Care · Sleep Support · Sports Nutrition · Weight Management ·
  > Women's Health · Other

  The short list in early blueprint drafts (Vitamins / Minerals / Protein / Herbal /
  Probiotics / Omega / Other) matches **none** of the seed rows and would fail every row
  on import. The catalogue is the source of truth; the enum follows it.

## 8. Open questions

- ~~Invoice number format & yearly reset~~ — **settled (D6):** `INV-<year>-<4-digit seq>` /
  `PUR-<year>-<seq>`, counter stores `{ seq, year }` and resets each January
  (Data Model §6).
- ~~PDF approach for sale invoices~~ — **settled (D2):** browser print-to-PDF,
  `window.print()` + a print stylesheet. No `jspdf` dependency.
- Whether the 3 previously flagged catalogue rows need price confirmation (currently
  reconciled — Invoice blueprint §2 states no rows require verification).
