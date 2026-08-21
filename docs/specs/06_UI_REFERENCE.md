# UI Reference / Style Guide — Biztrack Inventory & Invoicing

Grounded in the existing Biztrack design system (`src/index.css` `@theme`,
`design_system.md`) so new screens match the app. **Last updated:** 2026-07-19

---

## 1. Style guide (use the app's existing tokens)

### Colors (`@theme` in `src/index.css`)
| Role | Token / Hex |
|------|-------------|
| Primary (nav active, primary buttons) | `--color-primary` `#2563EB` |
| Secondary | `#3B82F6` |
| CTA / accent (sparingly) | `#F97316` |
| Page background | white / `#EFF6FF` tints |
| Surfaces | white cards on `slate-50` page |
| Text | `slate-900` primary, `slate-500` secondary, `slate-400` muted |
| Success (In stock / OK) | green-600 family |
| Warning (Low / Expiring soon) | amber-600 family |
| Danger (Out / Expired) | red-600 family |

Semantic badges only carry meaning through color — never decorative rainbow.

### Typography
- **Body:** Fira Sans (`--font-sans`).
- **Headings:** Inter (`--font-heading`).
- **Logo / mono / stock numbers:** Fira Code (`--font-mono`).
- Sentence case everywhere. No ALL CAPS except small uppercase table labels (letter-spaced).

### Spacing & components
- Data-dense dashboard aesthetic: minimal padding, grid layouts, maximum data visibility.
- Cards: white bg, rounded `rounded-lg`/`rounded-xl`, 0.5px `slate-200` border, subtle.
- Tables: `slate-50` header row, `slate-100` row dividers, row highlight on hover.
- Buttons: primary = `bg-primary text-white`; secondary = white + `slate-200` border.
- Metric cards: muted 13px label on top, 24–26px/500 number below.
- Badges/pills: tinted background + darker same-family text; small (11–12px).

### Interaction (pre-delivery checklist)
- FontAwesome icons (no emoji). `cursor-pointer` on clickables.
- Hover states 150–300 ms transitions; visible focus rings for keyboard nav.
- Respect `prefers-reduced-motion`. WCAG AA contrast (4.5:1 text).
- Responsive breakpoints: 375 / 768 / 1024 / 1440 px. Tables scroll or stack on mobile.

### Icons (FontAwesome, matches Sidebar)
- Inventory: `faBoxesStacked` · Invoices: `faFileInvoiceDollar` · Add: `faPlus`
- Edit: `faPen` · Print: `faPrint` · Download: `faDownload` · Search: `faMagnifyingGlass`
- Expiring/expired: `faTriangleExclamation` / `faCircleXmark` · In stock: `faCircleCheck`

---

## 2. Screen: Inventory (valuation + batches)

```
┌───────────────────────────────────────────────────────────────┐
│  Inventory                                     [ + Add product ]│
│  57 products · stock and expiry tracking                        │
├───────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ Total stock  │ │ Total VP     │ │ Total units  │  ← metric  │
│  │ value @50%   │ │ in stock     │ │              │    cards   │
│  │ ₹33,832      │ │ 587.70       │ │ 36           │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
├───────────────────────────────────────────────────────────────┤
│  Summary by product                                             │
│  Product              Qty   50% price   Value    VP             │
│  Formula 1 Straw…     20    1,246       24,920   435.00         │
│  Woman's Choice        6      712        4,272    74.70         │
│  …                                                              │
│  Total                36              33,832    587.70          │
├───────────────────────────────────────────────────────────────┤
│  Stock detail — by expiry (batches)          [ + Add batch ]    │
│  Product          Expiry        Qty   Value   VP    ⋯           │
│  Formula 1 Straw…  15 Nov 2026🟠  8   9,968  174.0  [edit]      │
│  ↳ same product    30 Jun 2027   12  14,952  261.0  [edit]      │
│  …                                                              │
└───────────────────────────────────────────────────────────────┘
```
- **Search + filters** row (category, stock status) between summary and detail.
- Expiry badge on batch rows: 🟠 amber "expiring soon", 🔴 red "expired", none/OK muted.
- No category column; category is a filter.
- **Batch row actions:** Edit (corrections) + **Write off** (shown prominently on expired
  batches — confirm dialog states qty + value being removed and asks a reason).
- Zero-quantity batches hidden by default; "Show empty batches" toggle reveals them.

---

## 3. Screen: Sale invoice builder

```
┌───────────────────────────────────────────────────────────────┐
│  New sale                     Invoice INV-2026-0001 · 18 Jul   │
│  Discount:  [ 0% Retail ▾ ]   ← one tier for whole invoice     │
│  Billed to: [ customer name ] [ phone ]                        │
├───────────────────────────────────────────────────────────────┤
│  Item                 Batch(expiry)   Qty  VP   Tot VP  Rate  Amt│
│  [Formula 1 Straw ▾] [15 Nov 2026 ▾]  [2] 21.75 43.50 1713 3426 │
│  [ + Add line ]                                                 │
├───────────────────────────────────────────────────────────────┤
│                              Items 7 · Total VP 90.85           │
│                              Total  ₹7,336        [ Save ]      │
└───────────────────────────────────────────────────────────────┘
```
- Batch dropdown lists that product's expiries with qty-on-hand; blocks oversell client-side
  (server re-checks with conditional writes — a `409` shows "Not enough stock in the
  selected batch (X available)" on the offending line).
- Live totals in footer. Default tier = 0% (Retail). Max 30 lines (blocked with
  "Split large orders into two invoices").
- **Save** finalizes (deducts stock); **Save as draft** stores without stock changes —
  drafts show a "Finalize" button on the invoice view.
- On save → **Invoice view** (read-only) with **Print / Save PDF**.

### Printed sale invoice (customer-facing)
- Header: associate name + contact · Invoice no. + date · "Billed to" customer.
- Table: Item · Qty · VP · Total VP · Rate · Amount.
- Totals: Total amount + Total VP. Footer: "Prices inclusive of GST".
- **Never shows** cost, 50% price, or profit.

---

## 4. Screen: Purchase (restock) builder

```
┌───────────────────────────────────────────────────────────────┐
│  New purchase  [Restock · adds to stock]   PUR-2026-0007 ·18Jul│
│  Buy price locked at 50%                                        │
│  Bought from: [ supplier name ]              Order date [ … ]   │
├───────────────────────────────────────────────────────────────┤
│  Item                 Qty   Expiry         Tot VP  Rate50  Amt  │
│  [Formula 1 Straw ▾]  [12] [30 Jun 2027]   261.00  1246  14,952 │
│  [ + Add item ]                                                 │
├───────────────────────────────────────────────────────────────┤
│                       Items 28 · Total VP earned 413.70        │
│                       Total cost ₹23,864  [ Save & add to stock]│
│  ⓘ Saving adds these to stock; matching expiry merges a batch. │
└───────────────────────────────────────────────────────────────┘
```
- No discount selector (locked 50%). "Bought from" instead of "Billed to".
- Per-line editable **expiry** input. Totals labelled "VP earned" / "cost".

---

## 5. Screen: Invoices list (tabs)

```
┌───────────────────────────────────────────────────────────────┐
│  Invoices                          [ Sales | Purchases ]  [ + ]│
│  ── Sales ─────────────────────────────────────────────────── │
│  No.            Date      Customer     Total     VP    Status  │
│  INV-2026-0001  18 Jul    Priya S.     ₹7,336   90.85  Paid    │
│  …                                                             │
└───────────────────────────────────────────────────────────────┘
```
- Tabs switch the `type` filter. Row click → invoice view. "+" starts a new doc of the active tab's type.

---

## 6. Dashboard additions

Three alert cards alongside existing KPIs: **Expiring ≤30d** (amber), **Expired** (red),
**Low stock** (amber). Each links to Inventory pre-filtered. Optionally show **Stock value**
and **VP in stock** as two more KPI cards.

---

## 7. Component inventory (for consistency)

| Component | Reuse from | Notes |
|-----------|-----------|-------|
| Metric card | dashboard cards | label + big number |
| Data table | Clients list | header row, hover highlight, dividers |
| Modal | `ClientModal` | product edit, batch edit |
| Filters bar | `ClientFilters` | search + selects |
| Import preview | `ImportPreviewModal` | Excel import |
| Toast | `ToastContext` | success/error feedback |
| Badge/pill | new (`StockBadge`, `ExpiryBadge`) | semantic colors |

## 8. States (define these up front so screens don't ship half-done)

| State | Treatment |
|-------|-----------|
| Loading | Skeleton rows for tables, pulse placeholders for metric cards (no spinners-only pages) |
| Empty inventory | "No products yet — import your catalogue or add a product." + Import + Add buttons |
| Empty invoices tab | "No sales yet. Create your first invoice." + primary CTA of the active tab's type |
| Empty batch picker | Inline note "Out of stock — restock via a purchase invoice" + link |
| Save error (409 stock) | Highlight the offending line in red, show available qty, keep the form state |
| Save error (network) | Toast "Couldn't save. Retry." — form state preserved, retry-safe (idempotent id) |
| Cancelled invoice | Grey "Cancelled" badge; totals struck through in the list |

**Mobile (≤768px):** metric cards 2-up then 1-up; tables collapse to stacked cards
(product name + key figures), batch picker becomes a bottom sheet; sticky totals footer
on the builder.

> Wireframes above are ASCII intent sketches; the interactive mockups shown during design
> (inventory valuation, sale invoice, purchase builder) are the visual reference for spacing
> and hierarchy. Keep to the tokens in §1 so AI-generated screens don't drift.
