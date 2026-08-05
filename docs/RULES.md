# BUSINESS RULES — `biztrack`

Rules **this app owns**. Fleet-wide rules live in `.ai-eos/standards/DOMAIN-INDIA.md`
— reference them by ID here, never restate them, or the two copies will diverge and
nobody will know which is current.

> **The test:** would this rule still be true if this app were deleted?
> Yes → it belongs in `DOMAIN-INDIA.md`. No → it belongs here.

---

## Fleet-wide rules this app implements

| Rule ID | Enforced at | Verified |
|---|---|---|
| BR-020 money never float | No `parseFloat` in the codebase; whole rupees throughout | ✅ `verify.sh` greps for it on every run |
| BR-030 soft delete | ❌ **NOT ENFORCED** — see `PROJECT.md` §8 D-01, tracked as FU-EOS-1 | ❌ |
| BR-031 audit trail | Partial — stock movements only (`STOCKMOVE#`). Clients/tasks/products not audited | ⚠️ |
| BR-033 four roles | ❌ **NOT APPLICABLE** — one user per account, see `PROJECT.md` §8 D-02 | n/a |
| BR-010 financial year | Not used. Invoice counters reset on the **calendar** year, not the FY | ⚠️ `[OWNER TO CONFIRM]` — see BR-BIZ-004 |

---

## Rules specific to this app

### BR-BIZ-001 — Volume points are rounded once, at the total

| Field | |
|---|---|
| **Rule** | VP is rounded to 2 decimal places on the **total** only, never per line before summing. |
| **Reason** | Rounding each line then adding compounds the error, and the monthly volume figure stops reconciling with Herbalife's own. |
| **Legal basis** | Internal policy — matches Herbalife's published price list, which quotes VP to 2dp. |
| **Verified as of** | Read from code 2026-08-05. Herbalife's rounding method itself is `[OWNER TO CONFIRM]`. |
| **Exceptions** | None. |
| **Owner** | Owner |
| **Priority** | 🔴 Critical |
| **Example** | 3 lines at 7.803 VP → sum 23.409 → `23.41`. Not `7.80 × 3 = 23.40`. |
| **Enforced at** | API + UI — `roundVp()` in [`src/shared/utils/pricing.ts`](../src/shared/utils/pricing.ts) and [`lambda/src/invoices.ts`](../lambda/src/invoices.ts) |

### BR-BIZ-002 — Stock leaves by earliest expiry first

| Field | |
|---|---|
| **Rule** | When a sale is finalized, stock is taken from the batch with the earliest expiry date first. |
| **Reason** | Perishable product. Selling newer stock first strands the older stock until it expires and must be written off. |
| **Legal basis** | Internal policy. |
| **Verified as of** | Read from code 2026-08-05. |
| **Exceptions** | None — the user cannot override batch selection. |
| **Owner** | Owner |
| **Priority** | 🔴 Critical |
| **Example** | 10 units requested; batches `2026-09-30` (4 units) and `2027-01-31` (20). Takes 4 then 6. |
| **Enforced at** | API — [`lambda/src/lib/stock.ts`](../lambda/src/lib/stock.ts) |

### BR-BIZ-003 — One discount tier per sale

| Field | |
|---|---|
| **Rule** | A sales invoice applies exactly one discount tier (0 / 25 / 35 / 42 / 50 %) to every line. Tier 0 reads the **Retail** price, not MRP. |
| **Reason** | The tier reflects the buyer's standing, which is a property of the customer, not of a line item. |
| **Legal basis** | Herbalife distributor price list — `[OWNER TO CONFIRM]` which price list version and effective date. |
| **Verified as of** | Read from code 2026-08-05 (PRD §6 records it as a locked decision). |
| **Exceptions** | Purchases are always at 50% — that is the user's own cost price. |
| **Owner** | Owner |
| **Priority** | 🟡 Important |
| **Example** | A 35% invoice prices every line from the product's `price35` field. |
| **Enforced at** | API + UI — `priceForTier()` in [`src/shared/utils/pricing.ts`](../src/shared/utils/pricing.ts) |

### BR-BIZ-004 — Invoice numbers are gapless per user, per type

| Field | |
|---|---|
| **Rule** | Every finalized document takes the next number from its own counter (`SALE` or `PURCHASE`), per user. The counter is incremented **before** the invoice is written. |
| **Reason** | A crash between the two writes burns a number, which is harmless. The reverse order would issue a duplicate number to two documents, which is not. |
| **Legal basis** | 🔴 `[OWNER TO CONFIRM]` — whether Indian invoice numbering requires a financial-year reset rather than the calendar-year reset currently implemented. **Do not code an FY reset until this is confirmed.** |
| **Verified as of** | Read from code 2026-08-05. |
| **Exceptions** | Draft invoices take no number until finalized. |
| **Owner** | Owner |
| **Priority** | 🔴 Critical |
| **Example** | Finalizing the 12th sale of the year yields the 12th `SALE` number for that user. |
| **Enforced at** | API — [`lambda/src/invoices.ts`](../lambda/src/invoices.ts); duplicate submits blocked by `attribute_not_exists(PK)` |

### BR-BIZ-005 — A finalized invoice cannot be deleted

| Field | |
|---|---|
| **Rule** | Only draft invoices may be deleted. A finalized invoice has moved stock and is part of the audit trail; it must be cancelled, not removed. |
| **Reason** | Deleting it would silently desynchronise stock levels from the movement history. |
| **Legal basis** | Internal policy. |
| **Verified as of** | Read from code 2026-08-05. |
| **Exceptions** | None. |
| **Owner** | Owner |
| **Priority** | 🔴 Critical |
| **Example** | `DELETE` on a finalized invoice → `409 NOT_DRAFT`. |
| **Enforced at** | API — [`lambda/src/invoices.ts`](../lambda/src/invoices.ts) |

---

## Engineering rules this app owns

Moved here from the project `CLAUDE.md` during AI-EOS adoption, so there is one
source rather than two. The secret-safety rule is important enough to stay in
`AGENTS.md` as well.

### BR-BIZ-E01 — Secrets never enter context

MUST load the `aws-secrets-manager` skill first for any secret, credential, API key,
token or password task. MUST NOT call `secretsmanager get-secret-value` or
`batch-get-secret-value`, and MUST NOT hit the Secrets Manager Agent daemon directly.
MUST use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec`
so the secret resolves at runtime without entering context. 🔴 Critical.

### BR-BIZ-E02 — Infrastructure is CDK, never the console

All infrastructure changes go through CDK in `infra/`. Prefer infrastructure-as-code
over direct CLI commands. A console change is invisible to the next `cdk deploy` and
will be silently reverted by it. 🔴 Critical.

### BR-BIZ-E03 — AWS specifics are verified, not guessed

When uncertain about an AWS detail (API parameters, permissions, limits, error
codes), verify against documentation rather than guessing, and state the uncertainty
explicitly. Prefer the AWS MCP Server for AWS interactions — sandboxed execution,
observability and audit logging; fall back to the AWS CLI only if unavailable. Check
for a relevant AWS skill (`retrieve_skill`) before starting. Follow Well-Architected
principles. 🟡 Important.

### BR-BIZ-E04 — No em dashes in AWS resource names or descriptions

Use hyphens. 🟢 Convention.

---

> **Never invent a tax rate, threshold, section number or due date.** If you cannot
> cite it, write 🔴 `[OWNER TO CONFIRM]` and stop. A confident wrong number here gets
> coded in, and nobody catches it until a client is affected.
