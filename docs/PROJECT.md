# Biztrack

Identity, how it works, and the decisions behind it.
**Mostly stable** — this changes when the app's shape changes, not when code changes.
Day-to-day history goes in `LOG.md`.

---

## 1. Identity

| Field | Value |
|---|---|
| App name | `biztrack` |
| What it does, in one line | Tracks a Herbalife distributor's clients, follow-up calls, tasks, team tree, stock and invoices in one place |
| Who uses it | The owner (one signed-in user per account; data is isolated per user) |
| Client | Internal |
| Built on | React 19 + Vite + TypeScript · AWS Lambda (Node 24) · DynamoDB · Cognito · CDK |
| Target | **aws** — `ap-south-1` |
| **Exposure** | authenticated (CloudFront public; every API route behind a Cognito authorizer) |
| Standard version | 3.0 — adopted 2026-08-05, categories 1–3 only |
| Platform version | none — `platform/` components are Docker/Postgres artefacts and do not apply (see §8) |
| State | 🟢 active |

## 2. Addresses

| | |
|---|---|
| Public URL | CloudFront distribution — `VITE_APP_URL` (CDK output `CloudFrontUrl`) |
| API | API Gateway REST, `prod` stage — CDK output `ApiUrl` |
| Health check | `<ApiUrl>/health` — see §8 D-04 for why it is not `/api/health` |
| Repository | `https://github.com/mananmaheshwari1702/Biztrack` |
| Host | AWS `ap-south-1`, account `346299179287` |
| Folder on host | n/a — serverless. Frontend is an S3 bucket behind CloudFront |

## 3. Credentials

> Never write a real secret here. Record the password-manager entry name only.

| What | Password manager entry |
|---|---|
| AWS account root / IAM | `[OWNER TO CONFIRM]` |
| Cognito dev user (local development) | `[OWNER TO CONFIRM]` |
| WhatsApp API credentials | `[OWNER TO CONFIRM]` |

There is no database password and no JWT secret: DynamoDB is reached with the
Lambda execution role, and tokens are issued and verified by Cognito.

## 4. Data model

**One DynamoDB table, single-table design.** `PK = USER#<uid>` for every business
item, where `uid` is the Cognito `sub` from the verified token — that partition key
*is* the tenancy boundary. Key shapes are defined once in
[`lambda/src/lib/db.ts`](../lambda/src/lib/db.ts); do not restate them here, they
will drift.

| Item type (`SK`) | Holds | Notes |
|---|---|---|
| `PROFILE` | user profile, timezone, account status | created by the Cognito PostConfirmation trigger |
| `CLIENT#<id>` | CRM records, follow-up dates | GSI1 for due/calendar range queries |
| `TASK#<id>` | tasks | |
| `ORG#<id>` | org tree nodes | |
| `PRODUCT#<id>` | product catalogue, VP + 5 price tiers | |
| `BATCH#<productId>#<expiry>` | stock by expiry date | expiry is *in* the key, so a same-expiry restock is one atomic `ADD` |
| `STOCKMOVE#<createdAt>#<id>` | stock movement audit trail | newest-first via `ScanIndexForward:false` |
| `INVOICE#<id>` | sale/purchase invoices | GSI6-InventoryDate orders them chronologically |
| `COUNTER#<SALE\|PURCHASE>` | invoice numbering counters | one per user per document type |

## 5. How it works ⭐

The two algorithms a reader cannot reconstruct from the code in ten minutes:

```
ALGORITHM: batch selection on a sale
PURPOSE:   decide which physical stock leaves when a sale is finalized, so that
           the oldest stock sells first and nothing expired is shipped
INPUT:     uid, invoice lines (productId, quantity, tier)
OUTPUT:    a set of atomic batch decrements + stock movement records

STEPS:
  1. FOR each line, load that product's batches (SK begins_with BATCH#<productId>#)
  2. Sort by expiryDate ascending — earliest expiry is consumed first
  3. Walk batches, taking from each until the line quantity is satisfied
  4. IF total available < requested THEN fail the WHOLE invoice with
       409 INSUFFICIENT_STOCK, carrying { productId, expiryDate, available }
  5. Write batch decrements, the product roll-up and the audit movements in ONE
     atomic transaction (see lambda/src/lib/stock.ts)

BUSINESS RULES APPLIED:
  - BR-BIZ-002 pick batch by earliest expiry
  - BR-BIZ-003 one discount tier per sale

FAILURE MODES:
  - Insufficient stock  -> 409 INSUFFICIENT_STOCK, nothing is written
  - Batch nets to zero  -> the batch row is dropped, the audit trail is kept
```

```
ALGORITHM: invoice numbering
PURPOSE:   give every finalized document a gapless, per-user, per-type number
INPUT:     uid, document type (SALE | PURCHASE), the document's calendar date
OUTPUT:    an invoice number

STEPS:
  1. Atomically increment COUNTER#<type> for that user
  2. THEN write the invoice
  3. The ORDER of these two writes is itself a correctness property — a crash
     between them burns a number, which is safe. The reverse order would issue
     a duplicate number, which is not.

FAILURE MODES:
  - Duplicate submit -> guarded by attribute_not_exists(PK) on the invoice key
```

## 6. Hidden assumptions

- **One user per account.** Data isolation *is* the partition key. There is no
  sharing, no team access, and therefore no role model (§8 D-02).
- **Money is whole rupees.** The Herbalife price list quotes no paise, so amounts
  are integers throughout and `formatInr` rounds for display.
- **Volume points are rounded once, at the total** — never per line before summing,
  or the error compounds and the monthly figure stops reconciling with Herbalife's.
- Assumes the user's timezone is `Asia/Kolkata` unless their profile says otherwise;
  date banding uses the `en-CA` locale trick to avoid a UTC off-by-one for the 5.5
  hours a day where UTC and IST fall on different dates.
- Assumes local development runs against the **production** table, isolated by using
  a dedicated Cognito dev user.

## 7. Edge cases NOT handled

- **Deleting a client, product or task is permanent.** There is no soft delete and
  no undo (§8 D-01). This is a known gap, tracked as FU-EOS-1.
- No general `audit_log`. Stock movements are audited; client/task/product edits are
  not — you cannot answer "who changed this client, and when?"
- ~~Lambda account concurrency is **10**~~ — **resolved 2026-08-06 (FU-0).** The quota
  is now **1,000** and twelve functions carry a reserved concurrency, so one bulk
  import can no longer starve signup. 267 reserved, 733 unreserved.
  `biztrack-post-confirmation` is the only function left on the shared pool, by
  decision — it is the signup critical path and rare, and every heavy function is now
  capped so nothing can drain the pool beneath it.
- No CI. Tests and lint run only when a human runs them.
- `npm run lint` is **red** (15 errors) and has been for some time.

## 8. Decisions specific to this app

Deviations from AI-EOS, decided during adoption on 2026-08-05. Each answers
*"why doesn't this app have X?"* so it is not re-litigated annually.

### D-01 — Hard delete, not soft delete · ⚠ deviation, not endorsed

`AGENTS.md` requires `is_deleted = true` and forbids `DELETE` on a business record.
Biztrack hard-deletes clients, products and tasks
([`clients.ts:258`](../lambda/src/clients.ts#L258),
[`products.ts:322`](../lambda/src/products.ts#L322),
[`tasks.ts:186`](../lambda/src/tasks.ts#L186)).

**Why it was not changed during adoption:** retrofitting soft delete touches every
read, query, count and export path in the app. That is a feature-sized change, and
adoption is explicitly not the place for it (`MIGRATION.md`).
**This is a deferral, not an approval.** Tracked as **FU-EOS-1**. Finalized invoices
are already protected — they are part of the audit trail and cannot be deleted.

### D-02 — No role model · ✓ deliberate

`AGENTS.md` fixes four fleet roles. Biztrack has exactly one user per account, and
the tenancy boundary is the DynamoDB partition key, enforced server-side from the
verified token. Adding `admin/manager/user/readonly` today would mean four roles, one
of which is ever used — an abstraction with no second case (`BUILD.md` §8, Rule of
Three). **Revisit the day team access is a requirement**, not before.

### D-03 — Error shape stays `{ error, message }` · ✓ deliberate

The platform error contract is `{"detail": "..."}`. Biztrack deliberately runs two
shapes, documented in [`lambda/src/lib/response.ts`](../lambda/src/lib/response.ts):
a legacy `{ error: "<sentence>" }` for clients/tasks/user, and a coded
`{ error: "CODE", message, ... }` for everything inventory and invoicing. The
frontend maps `body.error` onto `ApiError.code` and branches on it
(`INSUFFICIENT_STOCK`, `DUPLICATE`, …) — behaviour a human sentence cannot support.
Changing it breaks the shipped SPA for zero user-visible gain. The coded shape
carries strictly more information than `detail`. Kept, per `BUILD.md` §6.

### D-04 — Health endpoint is `/health`, not `/api/health` · ✓ deliberate

The contract's path assumes an app served behind one origin with the API under
`/api/`. Here the API *is* its own origin (API Gateway), and every existing route
sits at the root of the `prod` stage (`/clients`, `/products`, …). Mounting one
route under `/api/` would make it the only inconsistent path in the API. The
contract's *purpose* — one unauthenticated, cheap, never-removed endpoint per app —
is fully honoured. Fleet monitoring records the full URL per app anyway.

### D-05 — Serverless AWS, not Docker + Postgres + FastAPI · ✓ deliberate

`BUILD.md` §1 fixes the stack at Docker/Compose, PostgreSQL 16, Python/FastAPI and
nginx. Biztrack is React on S3/CloudFront, Lambda, DynamoDB and Cognito, managed by
CDK. Adopting the standard stack is not an adoption — it is a full rebuild of a
working, deployed application. Consequences accepted: the `platform/` components
(ingress, backup, auth containers) do not apply, `verify.sh` had to be rewritten for
this stack, and the fleet's Docker tooling will never work here.

### D-06 — Backup is PITR, not the six-endpoint backup contract · ✓ deliberate

`PLATFORM.md` §5 specifies six admin backup endpoints. DynamoDB point-in-time
recovery is enabled ([`biztrack-stack.ts:98`](../infra/lib/biztrack-stack.ts#L98))
and both the table and the user pool are `RemovalPolicy.RETAIN`. That is a stronger
guarantee than an app-managed dump, with no code to maintain.
⚠ **A restore has never been tested** — see §10.

### D-07 — Money is an integer, not `NUMERIC(18,2)` · ✓ intent met

DynamoDB has no decimal column type. The rule's *intent* — never lose paise to a
float — is met and verifiable: there is **no `parseFloat` anywhere in the codebase**,
amounts are whole rupees, and VP is rounded exactly once at the total
([`pricing.ts`](../src/shared/utils/pricing.ts)). `verify.sh` enforces the
no-float rule on every run.

### D-08 — Folder layout stays feature-based · ✓ deliberate

`BUILD.md` §2 specifies `backend/` + `frontend/`. Biztrack uses `src/features/*` +
`src/shared/*`, with `lambda/` and `infra/` separate. Moving files would break
imports, CDK asset bundling paths and every doc reference, for nothing a user can
see — the highest-risk, lowest-value change available (`MIGRATION.md`).

## 9. Integrations

| Integration | What breaks if it disappears |
|---|---|
| **AWS Cognito** | Nobody can sign in. Identity and the `uid` that partitions all data come from here. Total outage. |
| **DynamoDB** | Total outage. Single source of truth for all business data. |
| **WhatsApp API** | Follow-up reminders stop sending. The app keeps working; the scheduled Lambda fails. |
| **CloudFront + S3** | The frontend is unreachable. The API stays up. |
| **Herbalife price list** | Not an API — a seeded CSV (`docs/inventory/`). If tiers change, prices go stale silently. |

## 10. Data handling for this client

| | |
|---|---|
| Where data is stored | DynamoDB, `ap-south-1` (India) |
| Who can access it | The signed-in owner only; isolated by `PK = USER#<uid>` from the verified token |
| Backup frequency and location | Continuous — DynamoDB PITR, 35-day window, same region |
| Retention period | Indefinite while the account is `ACTIVE`. `PENDING_DELETION` accounts are purged by a daily Lambda |
| What happens on termination | Account marked `PENDING_DELETION`, blocked from all endpoints, then purged |
| Restore last tested on | 🔴 **NEVER** — an unrestored backup is a file, not a safety net. Tracked as FU-EOS-2 |
