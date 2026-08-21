# App Flow / User Flow — Biztrack Inventory & Invoicing

Step-by-step journeys. "System" = what the app/backend does automatically.
**Last updated:** 2026-07-19
**Corrections applied 2026-07-22:** resolves D5 (§4.2 — the scheduled report is WhatsApp
only; the app has no email pipeline).

---

## 0. Entry & navigation

1. User logs in (existing Cognito flow) → lands on Dashboard.
2. Sidebar/MobileNav shows new items: **Inventory** and **Invoices**.
3. Dashboard shows new alert cards: **Expiring ≤30d**, **Expired**, **Low stock**
   (each links into Inventory with the matching filter).

---

## 1. View inventory (valuation + batches)

1. User clicks **Inventory**.
2. System loads products (with cached roll-ups) and batches.
3. Screen shows:
   - **Top:** three cards — Total stock value @50%, Total VP in stock, Total units.
   - **Middle:** per-product summary table (qty · 50% price · value · VP) + totals row.
   - **Bottom:** batch detail table — one row per product+expiry, sorted soonest-first,
     with expiry badges (Expired / Expiring soon / OK).
4. User can **search** (name or stock no.), **filter** by category or stock status.
5. **Empty state:** "No products yet — import your catalogue or add a product." with an
   Import button (see Flow 5).

**Edge cases**
- Product with 0 total quantity → shows "Out of stock" badge, value ₹0.
- Batch already expired → red "Expired" badge; still counted in value until written off.

---

## 2. Create a SALE invoice (sell to a customer)

1. User goes to **Invoices → Sales tab → New sale**.
2. **Header:** system pre-fills invoice no. (`INV-2026-XXXX`) and today's date. User picks
   **one discount tier** (default 0% / Retail).
3. **Billed to:** user enters customer name (phone/email/address optional).
4. **Add line:**
   a. Pick a product (search by name or stock no.).
   b. Pick a **batch (expiry)** from a dropdown listing that product's available expiries
      with qty-on-hand.
   c. Enter quantity.
   d. System live-computes rate (from the invoice tier), line amount, per-piece VP, total VP.
5. Repeat for more lines. Footer shows running **Total amount** and **Total VP**.
6. User clicks **Save**.
7. **System (atomic):** re-reads each product, recomputes prices/totals, assigns the
   invoice number, deducts each line's quantity from its chosen batch, writes `OUT`
   movements, updates product roll-ups — all in one transaction.
8. User lands on the **invoice view** with a **Print / Save PDF** button. The printed bill
   shows items, qty, rate, amount, totals, VP, and "Prices inclusive of GST" — **no cost/profit**.

**Error & edge cases**
- **Insufficient batch stock:** if a line's qty exceeds the selected batch, the whole save
  is rejected with "Not enough stock in the selected batch (X available)." Nothing is deducted.
- **Product out of stock entirely:** batch dropdown is empty → line can't be completed; prompt to restock.
- **Price changed since adding the line:** server uses current catalogue price and returns
  the authoritative totals; UI reconciles.
- **Draft:** user may save as draft (no stock deducted). Finalizing later calls
  `POST /invoices/{id}/finalize`, which re-validates stock and prices **at finalize time**
  (batches may have changed since the draft was written) and applies stock atomically.
- **Duplicate submit / retry:** the client generates the invoice id up front; a retried
  save is detected server-side and returns the already-created invoice instead of
  deducting stock twice.
- **More than 30 lines:** UI blocks adding line 31 with "Split large orders into two
  invoices" (transaction size limit).
- **Network failure on save:** optimistic UI reverts; toast "Couldn't save invoice. Retry."

---

## 3. Create a PURCHASE invoice (restock yourself)

1. User goes to **Invoices → Purchases tab → New purchase**.
2. **Header:** system pre-fills purchase no. (`PUR-2026-XXXX`) and date. Buy price is
   **locked at 50%** (no tier selector).
3. **Bought from:** user enters supplier (e.g. "Herbalife India Pvt. Ltd.").
4. **Add line:** pick product, enter quantity, enter **expiry date** for the shipment.
   System shows total VP, rate (50%), amount per line.
5. Footer shows **Total cost** and **Total VP earned**.
6. User clicks **Save & add to stock**.
7. **System (atomic):** for each line, adds quantity to `BATCH#<product>#<expiry>` (creates
   it if the expiry is new, merges if it already exists), writes `IN` movements, refreshes
   product roll-ups and earliest expiry.
8. Confirmation → the new stock and batches now appear in Inventory.

**Edge cases**
- **Same expiry as existing batch:** quantity merges into that batch (no duplicate row).
- **Same product + same expiry on two lines of one purchase:** server merges them into a
  single batch update before applying (never two conflicting writes to one key).
- **New product not in catalogue:** user must add it to the catalogue first (or import).
- **Cancel a finalized purchase:** removes the added stock; if part of that stock was
  already sold, the cancel is blocked with "X units already sold from this purchase.
  Adjust the remaining batches instead." → link to the batch correction flow (Flow 6).

---

## 4. Alerts flow

1. **In-app:** Dashboard cards show live counts (expiring ≤30d, expired, low stock);
   clicking a card opens Inventory filtered to those items.
2. **Scheduled:** the existing daily **WhatsApp** report includes an "Inventory alerts"
   section — expiring-soon batches (name · expiry · qty) and low-stock products — gated by a
   user setting on the Profile page. (WhatsApp only; there is no email report to extend.)

---

## 5. Import / export catalogue

1. **Import:** Inventory → Import → choose the seed spreadsheet (`herbalife_products_seed.xlsx`).
2. System parses rows, shows a **preview** (valid vs flagged rows), user confirms.
3. Products (and optional opening batches) are created via bulk endpoints; a summary is shown
   ("imported / requested / failed").
4. **Export:** Inventory → Export → downloads the current catalogue as `.xlsx`.

**Edge cases**
- Malformed rows are reported in the preview, never silently dropped.
- Re-importing an existing stock no. updates that product (upsert) rather than duplicating.

---

## 6. Cancel / correct / write off

- **Cancel invoice:** from the invoice view; sets status Cancelled and reverses stock
  (sale → add back to the batch; purchase → remove). Finalized invoices are otherwise immutable.
- **Correct a batch:** Inventory → batch row → Edit (`BatchModal`) for manual qty/expiry
  corrections (rare; normal flow is via invoices). Writes an `ADJUST` movement.
  Changing a batch's **expiry** re-keys it: if a batch at the new expiry already exists,
  the quantities merge; otherwise the row moves to the new date.
- **Write off expired/damaged stock:** Inventory → batch row (typically one with a red
  "Expired" badge) → **Write off**. Confirm dialog shows qty + value being removed and a
  reason (Expired / Damaged / Other). System zeroes the batch, writes a `WRITE_OFF`
  movement, and updates roll-ups — the loss disappears from stock value and the expired
  alert clears. Written-off qty is visible in the movement log (audit).
- **Edit product:** catalogue details only (name, reorder level, prices) — not stock.

---

## 7. State & status summary

- **Invoice status:** Draft → Finalized → (optionally) Cancelled.
- **Stock applied flag:** true once a finalized invoice has moved stock.
- **Batch lifecycle:** created on first purchase at an expiry → quantity changes via
  invoices/write-offs → reaches 0. **Zero-quantity batches are kept** (audit trail,
  movement history references them) but **hidden by default** in the batch table
  (`Show empty batches` toggle / `includeEmpty` query param).
