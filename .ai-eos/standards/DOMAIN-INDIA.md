# DOMAIN — INDIAN BUSINESS & TAX

**The knowledge that exists only in a founder's head.** Owner: Amit · Append-only

> **Why this file matters most.** Everything else is reconstructible. Lose the code,
> rebuild it from `docs/PROJECT.md`. Lose a host, rebuild it from `OPERATE.md`. Lose
> this, and nobody — no developer, no AI, neither of you in 2031 — can recover *why*
> a TDS entry matches. There is one copy, and it is in a human head until it is here.

---

## §0 — READ THIS BEFORE TRUSTING ANY RULE

Rules that are **structural** — provable from the system design — are filled in.
**Every tax-specific value is deliberately blank.**

Not because they are hard to look up, but because a wrong number is worse than none.
An AI reading `194J = 10%` with no year attached codes it in as current fact, and
nobody catches it until a client is under-deducted.

**🔴 = not yet verified. Do not build on it.** Write `[OWNER TO CONFIRM]`, never a guess.

**Scope.** This file holds rules true of *Indian business generally* — money, dates,
identifiers, financial years, statutory concepts. Rules true of *one client's
business* go in that project's `docs/RULES.md`. The test: **would this rule still be
true if this app were deleted?** Yes → here. No → the project.

---

## §1 — RULE FORMAT

Nine fields. A rule missing `Legal basis` or `Verified as of` is a liability, not
documentation.

| Field | Meaning |
|---|---|
| **Rule** | What must always be true. One sentence, testable. |
| **Reason** | The business or legal consequence of breaking it |
| **Legal basis** | Act / section / rule / circular — or `Internal policy`. Say which. |
| **Verified as of** | `FY 2026-27` + who verified |
| **Exceptions** | When it does NOT apply. Write `None` explicitly, never blank. |
| **Owner** | Who decides if this changes |
| **Priority** | 🔴 Critical (legal or financial exposure) · 🟡 Important · 🟢 Convention |
| **Example** | A concrete case with real-shaped values |
| **Enforced at** | DB constraint / API / UI / manual — or `NOT ENFORCED` |

> **`Enforced at` is the field people skip and the one that matters most.** A rule
> nobody enforces is a wish. `NOT ENFORCED` is an acceptable answer — it means
> someone looked.

---

## §2 — REVIEW TRIGGER

| When | What |
|---|---|
| **Within 30 days of every Union Budget** | Re-verify every rule citing the Income Tax Act, GST Act or Companies Act. Update `Verified as of`. |
| **1 April, yearly** | Bump `Verified as of` on rules confirmed unchanged. Anything still showing a stale FY is now suspect. |
| **On any rule change** | Find every app implementing it via `Enforced at`, and patch them together. |

At a hundred apps, "find every app implementing this rule" must be a `grep` across
repos for the rule ID — which is why `BUILD.md` §8 requires every function touching
a business rule to cite its ID in a comment.

---

## §3 — IDENTITY & MASTER DATA

| ID | Rule | Priority | Status |
|---|---|---|---|
| BR-001 | Client code is unique and permanent. Never reused, never re-issued. | 🔴 | structural |
| BR-002 | PAN is mandatory for a client record and format-validated `[A-Z]{5}[0-9]{4}[A-Z]` | 🔴 | structural |
| BR-003 | GSTIN format and checksum validated where GST applies | 🔴 | 🔴 checksum algorithm to confirm |
| BR-004 | TAN required wherever TDS is deducted | 🔴 | structural |
| BR-005 | One legal entity, one master record. Duplicates are merged, never both kept. | 🔴 | structural |

---

## §4 — FINANCIAL YEAR & PERIODS

| ID | Rule | Priority | Status |
|---|---|---|---|
| BR-010 | Financial year runs 1 April – 31 March, stored as `VARCHAR(7)` `YYYY-YY`, e.g. `2025-26`. **Never derived from a date inside a query.** | 🔴 | structural |
| BR-011 | Assessment year = financial year + 1 | 🔴 | structural |
| BR-012 | TDS quarters are **not** calendar quarters: Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar | 🔴 | structural |
| BR-013 | Statutory due dates | 🔴 | **🔴 OWNER TO CONFIRM — every date blank on purpose** |

---

## §5 — MONEY, ROUNDING & MATCHING

| ID | Rule | Priority | Status |
|---|---|---|---|
| BR-020 | Money is `NUMERIC(18,2)`. Never float, at any point — not in the database, not in Python, not in JSON, not in an intermediate. | 🔴 | structural |
| BR-021 | Rounding method and where it is applied | 🔴 | **🔴 OWNER TO CONFIRM** |
| BR-022 | TDS matching tolerance | 🔴 | **🔴 OWNER TO CONFIRM** — Form 26AS rounds to whole rupees while book entries carry paise, so an exact match will fail legitimately. The tolerance value is a business decision, not an engineering one. |
| BR-023 | Amounts display Indian-style: `Rs 12,34,567.00` (lakh/crore grouping), never `1,234,567` | 🟡 | structural |
| BR-024 | Dates display `DD-MM-YYYY`, store ISO | 🟡 | structural |

---

## §6 — AUDIT, RETENTION & ACCESS

| ID | Rule | Priority | Status |
|---|---|---|---|
| BR-030 | Soft delete, never physical removal, on any business record | 🔴 | structural |
| BR-031 | Every change attributed: who, when, old value → new value | 🔴 | structural |
| BR-032 | Client financial data is not on the open internet without authentication, TLS and audit logging | 🔴 | structural |
| BR-033 | Four role names — `admin` · `manager` · `user` · `readonly` — mean the same thing in every app. Scope per role is set per app. | 🟡 | structural |
| BR-034 | Statutory record retention period | 🔴 | **🔴 OWNER TO CONFIRM** — drives how long we must keep a departed client's data, which is a contract term |

---

## §7 — THE FILL-IN CHECKLIST

The highest-value hour available anywhere in this system. Everything marked 🔴 above
is a number an AI will otherwise invent.

- [ ] BR-013 — every statutory due date, with the section that sets it
- [ ] BR-021 — rounding method and the point of application
- [ ] BR-022 — the matching tolerance, and why it is that number
- [ ] BR-003 — the GSTIN checksum algorithm
- [ ] BR-034 — retention period per record type

For each: fill all nine fields from §1. A filled `Rule` with a blank `Legal basis`
is not done — that is the field that lets the next person re-verify it after a
Budget without starting from scratch.
