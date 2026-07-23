# API Contract / Endpoint Spec — Biztrack Inventory & Invoicing

Base URL: existing Biztrack API Gateway (`API_URL`). All routes mirror the conventions in
`lambda/src/tasks.ts` / `apiService.ts`.
**Last updated:** 2026-07-19
**Corrections applied 2026-07-22:** adds §0 (error shape, resolving C4 — `conflict()` and a
code-carrying `badRequest` are **new helpers to be written**); renames the expiry index to
`GSI6-InventoryDate` (C1); notes invoice `SK = INVOICE#<id>` (C7).

---

## Conventions (apply to every endpoint)

- **Auth:** `Authorization: <Cognito ID token>` header, required. `uid` is derived
  server-side from the token; it is never accepted from the client.
- **Content type:** `application/json`.
- **Success:** `200` (read/update), `201` (create), `204` (delete/no content).
- **Pagination:** list endpoints accept `limit` and `nextToken`; respond with
  `nextToken: string | null` (base64 of DynamoDB `LastEvaluatedKey`).
- **Errors:** see §0 below — every endpoint in this document returns
  `{ "error": "CODE", "message": "human text" }`.
- **Money/VP:** numbers (INR). VP has 2 decimals.

---

## 0. Error shape (read before implementing any endpoint)

### The contract

Every endpoint defined in this document returns, on failure:

```json
{ "error": "MACHINE_CODE", "message": "Human-readable text", "...": "optional context" }
```

`error` is a **stable SCREAMING_SNAKE code** the client branches on. `message` is display
text and may be reworded freely. Extra keys carry context (e.g. `available`, `productId`).

| Status | Codes used by this feature |
|--------|----------------------------|
| `400` | `VALIDATION`, `TOO_MANY_LINES` |
| `401` | `UNAUTHENTICATED` |
| `403` | `ACCOUNT_PENDING_DELETION` |
| `404` | `NOT_FOUND` |
| `409` | `INSUFFICIENT_STOCK`, `DUPLICATE`, `NOT_DRAFT`, `STOCK_ALREADY_SOLD`, `BATCH_EMPTY` |
| `429` | `RATE_LIMITED` |
| `500` | `INTERNAL` |

### What has to be built first (C4)

`lambda/src/lib/response.ts` does **not** currently support this shape:

- `badRequest(message)` and `notFound(message)` emit `{ error: <the human sentence> }` —
  the message lands in the `error` field, so there is no code to branch on.
- **There is no 409 helper at all.**
- Only `forbidden(error, message, extra)` and `tooManyRequests(message, extra)` already
  follow the `{ error: CODE, message }` shape; model the new helpers on `forbidden`.

Two additions are required in Phase 2 before any endpoint below can honour its contract:

```ts
conflict(code: string, message: string, extra?: Record<string, unknown>)  // 409
badRequest(code: string, message: string, extra?: Record<string, unknown>) // code-carrying
```

**Do not change the existing helpers' behaviour for clients/tasks.** Those handlers pass a
bare human string and their current responses are part of the shipped contract; add the
code-carrying form alongside (an overload or a new name), and use it only in the new
handlers.

### Why the code matters on the client

`apiService.ts` maps `code = body.error` into `ApiError` (`ApiError.code`). With the
current helpers a 400 yields `code === "title is required"` — unusable. The UI states in
`06_UI_REFERENCE` §8 (highlight the offending line on `INSUFFICIENT_STOCK`, treat
`DUPLICATE` as success on retry) depend on the code being a code.

---

## 1. Products

### `GET /products`
Query: `search?`, `category?`, `stockStatus?` (In Stock|Low Stock|Out of Stock),
`expiringInDays?`, `status?` (`expired`), `sortBy?` (name|stockNo|quantity|value|expiry),
`limit?`, `nextToken?`.

- `search` matches the product name (case-insensitive) or the stock no.
- `expiringInDays=N` and `status=expired` both filter on the **cached
  `earliestExpiry`**, keeping the list a single query. `expiringInDays` covers
  `today … today+N`; **`status=expired`** covers `earliestExpiry < today`, which
  `expiringInDays` cannot express — it is what the dashboard's red *Expired* card
  deep-links to. For batch-level precision use `GET /batches` (§2), which ranges over
  `GSI6-InventoryDate`.
- `sortBy` orders the returned **page**. DynamoDB sorts by sort key (`PRODUCT#<uuid>`,
  i.e. arbitrary) and cannot order by an attribute without an index; the frontend hook
  exhausts every page before rendering, so the user still sees a fully ordered list.

Response `200`:
```json
{
  "products": [
    {
      "id": "p_01", "stockNo": "1239",
      "name": "Formula 1 — Strawberry - 500 gms", "category": "Weight Management",
      "vp": 21.75, "retail": 2075, "price25": 1713, "price35": 1526,
      "price42": 1396, "price50": 1246,
      "reorderLevel": 10, "totalQuantity": 20, "earliestExpiry": "2026-11-15",
      "createdAt": "2026-07-18T10:00:00Z"
    }
  ],
  "nextToken": null,
  "count": 1
}
```

### `GET /products/{id}`
Response `200`: a single `Product` (as above). `404` if missing.

### `POST /products`
Body: `Product` (without server fields). Creates a catalogue item (no stock).
Response `201`: created `Product`.

### `PUT /products/{id}`
Body: `Product`. Updates **catalogue fields only** (name, prices, reorderLevel, category,
unit, vp). Response `200`: updated `Product`. `404 NOT_FOUND` if missing.

**Server-owned fields are silently dropped, then restored from the stored row:**
`totalQuantity`, `earliestExpiry`, `invDate`. They are caches that only the stock engine
may write, inside the transaction that also moves the batches.

Dropping rather than rejecting is deliberate — the client round-trips the whole `Product`
it was given (matching `clientsApi.update`), so rejecting would fail a plain rename purely
for echoing back the `totalQuantity` the server itself sent. And because this is a
full-item write, dropping alone would *erase* the roll-ups; the handler re-reads the
stored row and carries them over. `createdAt` is preserved the same way; `updatedAt` is
stamped server-side.

### `DELETE /products/{id}`
Response `204`. (Batches/movements retained as history unless separately purged.)

### `POST /products/bulk`  (Excel import)
Body: `{ "products": Product[] }`. **Upsert semantics:** rows are matched by `stockNo`;
an existing `stockNo` updates that product's catalogue fields (never touches its batches
or stock), a new `stockNo` creates. Response `200`:
```json
{ "imported": 40, "updated": 17, "requested": 57, "failed": 0, "timedOut": false }
```

- **Match key is normalized** — trimmed and upper-cased — so a hand-edited `127k` updates
  the existing `127K` row instead of creating a twin.
- **Two rows normalizing to the same `stockNo` are rejected**, since they would be two
  writes to one key in a single batch: `400 VALIDATION` with the offending index, e.g.
  `{ "error": "VALIDATION", "message": "products[12]: duplicate stockNo \"127K\" in this import", "row": 12 }`.
- **Every row is validated before any write**, so a bad row at index 40 cannot leave rows
  0–39 already persisted.
- `imported` and `updated` are counted from **separate** batch passes, so both stay
  accurate under a partial write. `failed = requested − (imported + updated)`;
  `timedOut` means the 20s budget ran out mid-import.
- Server-owned fields are dropped and restored exactly as for `PUT` above.

### `DELETE /products/bulk`
Body: `{ "ids": string[] }`. Response `200`: `{ "deleted": n, "requested": n, "timedOut": false }`.

---

## 2. Batches

### `GET /products/{id}/batches`
Query: `includeEmpty?` (default false — zero-quantity batches hidden). Response `200`:
```json
{
  "batches": [
    { "id": "p_01#2026-11-15", "productId": "p_01", "expiryDate": "2026-11-15", "quantity": 8 },
    { "id": "p_01#2027-06-30", "productId": "p_01", "expiryDate": "2027-06-30", "quantity": 12 }
  ]
}
```
Used by the SALE batch picker. Batches are **not** created via a direct endpoint — they are
created/merged by purchase invoices (and Excel import).

### `GET /batches?expiringInDays=30` · `GET /batches?status=expired`
Range queries over `GSI6-InventoryDate` (`invDate` = the batch's `expiryDate`), filtered
with `begins_with(SK, 'BATCH#')`: `expiringInDays=N` → `invDate BETWEEN today AND today+N`;
`status=expired` → `invDate < today`. Both return only `quantity > 0` batches. Response `200`:
```json
{ "batches": [ { "id": "...", "productId": "...", "productName": "...", "expiryDate": "2026-08-05", "quantity": 8 } ], "nextToken": null }
```

### `PUT /batches/{productId}/{expiry}`  (manual correction only)
Body: `{ "quantity": number, "expiryDate"?: string, "note"?: string }`. `quantity` is
**absolute** — state what the batch actually holds; the server derives the delta. Writes
an `ADJUST` movement and updates product roll-ups atomically.
Response `200`: updated `Batch`. `404 NOT_FOUND` if the batch or product is missing.

**Re-keying (when `expiryDate` changes).** The expiry is part of the sort key, so the
stock moves between rows. This is expressed as **two ordinary stock changes in one
transaction** — a decrement at the old expiry and an increment at the new one — which
means the engine's aggregation, oversell conditions and movement logging all apply
unmodified.

- **The source row is zeroed, not deleted.** Movement records reference batches by
  `(productId, expiryDate)`; deleting the row would orphan the audit trail, and Data
  Model §3 retains zero-quantity batches by policy. The emptied row stays as history and
  is hidden from lists by default (`includeEmpty=false`).
- **If the destination expiry already holds stock, the quantities merge** — the increment
  is a DynamoDB `ADD`, so a destination holding 10 that receives 5 ends at 15. That is a
  single write to that key, never two.
- A move leaves `product.totalQuantity` unchanged (net zero) but can change
  `earliestExpiry` in either direction: moving *earlier* is resolved inline, moving
  *later* is resolved by the post-transaction recompute (TRD §5).

`409 INSUFFICIENT_STOCK` if the batch changed in flight and the guard rejected the write.

### `POST /batches/{productId}/{expiry}/write-off`
Body: `{ "reason": "Expired" | "Damaged" | "Other", "note"?: string }`. Zeroes the batch,
writes a `WRITE_OFF` movement (with the removed qty), updates roll-ups atomically.
Response `200`: `{ "batch": Batch, "writtenOff": 5 }`. `409` if the batch is already 0.

---

## 3. Invoices (Sales & Purchases)

### `GET /invoices`
Query: `type?` (SALE|PURCHASE), `from?`, `to?`, `status?`, `limit?`, `nextToken?`. Newest-first.
Served from `GSI6-InventoryDate` (`invDate` = `createdAt`, `ScanIndexForward: false`,
filtered with `begins_with(SK, 'INVOICE#')`).
Response `200`: `{ "invoices": Invoice[], "nextToken": string|null }`.

### `GET /invoices/{id}`
A direct `GetItem` on `SK = INVOICE#<id>` — the id alone is the key (Data Model §4, C7).
Response `200`: a single `Invoice` (with embedded `lines`). `404 NOT_FOUND` if missing.

### `POST /invoices?finalize=true`
Creates a SALE or PURCHASE. Server assigns the number, recomputes all prices/totals, and —
if `finalize=true` — applies stock atomically.

Request (SALE) — **note the client-generated `id` (idempotency key):**
```json
{
  "id": "b3f9c2e4-…",
  "type": "SALE",
  "tier": 25,
  "partyName": "Priya Sharma", "partyPhone": "+9190XXXXXXXX",
  "lines": [
    { "productId": "p_01", "expiryDate": "2026-11-15", "quantity": 2 },
    { "productId": "p_09", "expiryDate": "2027-03-15", "quantity": 1 }
  ]
}
```
Request (PURCHASE):
```json
{
  "type": "PURCHASE",
  "partyName": "Herbalife India Pvt. Ltd.",
  "lines": [
    { "productId": "p_01", "expiryDate": "2027-06-30", "quantity": 12 }
  ]
}
```
> Client sends only `productId`, `expiryDate`, `quantity` (+ tier/party). Server fills
> `unitPrice`, `unitVp`, `lineAmount`, `lineVp`, `name`, `stockNo`, totals, `invoiceNo`.

Response `201`: the saved `Invoice` with fully computed `lines` and totals.

Errors:
- `409 INSUFFICIENT_STOCK` — a SALE line exceeds its batch (enforced via conditional write, race-safe): `{ "error":"INSUFFICIENT_STOCK", "message":"Not enough stock in the selected batch (5 available)", "productId":"p_01", "expiryDate":"2026-11-15", "available":5 }`. Nothing is written.
- `409 DUPLICATE` — an invoice with this `id` already exists (idempotent retry). Client
  should `GET /invoices/{id}` and treat as success.
- `400 TOO_MANY_LINES` — more than 30 lines (transaction size limit).
- `400 VALIDATION` — missing party/lines, unknown product, bad tier.

Purchase-specific behavior: duplicate `(productId, expiryDate)` lines are merged server-side
into one batch update before the transaction is built.

### `PUT /invoices/{id}`
Body: `Invoice`. Allowed only while `status = Draft`. Response `200`. Finalized invoices are immutable.

### `POST /invoices/{id}/finalize`
Finalizes a **Draft**: re-reads products/batches, **re-validates stock and re-prices at
finalize time** (state may have changed since the draft), then applies stock atomically —
identical semantics to `POST …?finalize=true`. Response `200`: finalized `Invoice`.
Errors: same as create (`409 INSUFFICIENT_STOCK`, etc.). `409 NOT_DRAFT` if already finalized/cancelled.

### `POST /invoices/{id}/cancel`
Sets `status = Cancelled` and reverses stock (SALE → add back; PURCHASE → remove).
Response `200`: updated `Invoice`. `409 STOCK_ALREADY_SOLD` if reversal would make a batch
negative (message directs the user to batch corrections instead).

### `DELETE /invoices/{id}`
Deletes a `Draft`. Response `204`. Finalized invoices cannot be deleted (cancel instead).

---

## 4. Stock movements (read-only audit)

### `GET /stock-movements`
Query: `productId?`, `type?` (IN|OUT|ADJUST|WRITE_OFF), `from?`, `to?`, `limit?`,
`nextToken?`. Newest-first.
Response `200`: `{ "movements": StockMovement[], "nextToken": string|null }`.

`from` / `to` accept either a date (`2026-07-22`) or a full timestamp
(`2026-07-22T10:00:00.000Z`); a bare date covers that whole day. Because `createdAt`
leads the sort key (`STOCKMOVE#<createdAt>#<id>`), the range is answered by a key
condition rather than a filter — only the rows in the window are read.

**Read-only.** Movements are written exclusively by the stock engine, inside the same
transaction that moves the batch and the product roll-up. That coupling is the guarantee —
a movement cannot exist without the stock change it records, or the reverse — and an
endpoint that accepted client-created movements would break it silently.

### What a write attempt actually returns: `403`, not `405`

Only `GET` and `OPTIONS` are wired on `/stock-movements` in API Gateway. An unrouted verb
is therefore rejected **at the routing layer, before the Lambda is invoked**, so the
handler's own `405` is never what a client sees. Verified against the deployed stack
2026-07-23:

| Request | Response |
|---------|----------|
| `POST /stock-movements` with a valid `Authorization` header | `403` · `x-amzn-errortype: IncompleteSignatureException` · body complains about missing `Credential` / `Signature` / `SignedHeaders` |
| `POST /stock-movements` with no `Authorization` header | `403 {"message":"Missing Authentication Token"}` |

Neither message is about the method, which makes them confusing on first read. Both are
**standard API Gateway behaviour for any unrouted method on any endpoint** — nothing
specific to this one. With no method configured, API Gateway falls through to its IAM
(SigV4) path: absent a header it reports "Missing Authentication Token"; present but
holding a Cognito JWT rather than a SigV4 signature, it reports the signature as
malformed. Expect exactly the same from, say, `PATCH /products`.

### The handler's `405` is deliberate — do not delete it as dead code

`stockMovements.ts` answers any non-`GET` with `405 METHOD_NOT_ALLOWED` and an
`Allow: GET` header. Confirmed reachable by invoking the function directly:

```
$ aws lambda invoke --function-name biztrack-stock-movements --payload '{"httpMethod":"POST",...}'
405   Allow: GET
{"error":"METHOD_NOT_ALLOWED","message":"Stock movements are written by the system when
 stock changes; they cannot be created, edited or deleted directly"}
```

It is unreachable *through API Gateway today*, and it is kept anyway, for two reasons:

1. **Direct invocation** — console tests, the AWS CLI, or any future non-API-Gateway
   caller (an EventBridge target, a Step Functions task) reaches the handler directly and
   gets a correct, self-explaining refusal instead of a stack trace or a silent 200.
2. **Route widening is a one-line change.** If anyone ever adds `POST` to the resource in
   `biztrack-stack.ts` — deliberately or by copying a block from `/products` — the `405`
   is what stops a write from being accepted. Removing it now would turn that future
   one-line mistake into a data-integrity bug.

Read this the other way round: **the 403 is the accident of the current routing, and the
405 is the intended contract.** Keep them consistent by leaving the handler alone.

---

## 5. Dashboard (extended)

### `GET /dashboard`
Existing endpoint, extended `counts`:
```json
{
  "counts": {
    "dueCalls": 0, "totalClients": 0, "pendingTasks": 0, "overdueTasks": 0, "completedTasks": 0,
    "expiringSoon": 4, "expired": 2, "lowStock": 6,
    "stockValue": 33832, "vpInStock": 587.70
  }
}
```

---

## 6. Frontend service layer mapping (`apiService.ts`)

| Object | Methods |
|--------|---------|
| `productsApi` | `list`, `get`, `add`, `update`, `delete`, `bulkAdd`, `bulkDelete`, `batches(id)` |
| `batchesApi` | `expiring(days)`, `expired()`, `adjust(productId, expiry, body)`, `writeOff(productId, expiry, reason)` |
| `invoicesApi` | `list(type)`, `get`, `create(inv, finalize)`, `update`, `finalize(id)`, `cancel`, `delete` |
| `stockApi` | `list` (read-only) |
| `dashboardApi` | `get` (existing, extended) |

All use the existing private `request<T>()` helper (Cognito token + error handling).
