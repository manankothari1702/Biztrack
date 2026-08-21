# BUSINESS RULES — `<APP>`

Rules **this app owns**. Fleet-wide rules live in
`AI-Engineering-Operating-System/standards/DOMAIN-INDIA.md` — reference them by ID
here, never restate them, or the two copies will diverge and nobody will know which
is current.

> **The test:** would this rule still be true if this app were deleted?
> Yes → it belongs in `DOMAIN-INDIA.md`. No → it belongs here.

Per-app rules are not a lesser form of documentation. In a reconciliation tool, the
matching tolerance is the single most important rule in the system, and it lives here.

---

## Fleet-wide rules this app implements

| Rule ID | Enforced at | Verified |
|---|---|---|
| BR-002 PAN mandatory | | |
| BR-010 financial year | | |
| BR-020 money `NUMERIC(18,2)` | | |
| BR-030 soft delete | | |
| BR-031 audit trail | | |
| BR-033 four roles | | |

---

## Rules specific to this app

### BR-<APP>-001 — <short name>

| Field | |
|---|---|
| **Rule** | What must always be true. One sentence, testable. |
| **Reason** | The business or legal consequence of breaking it |
| **Legal basis** | Act / section / rule / circular — or `Internal policy`. Say which. |
| **Verified as of** | `FY 2026-27`, and by whom |
| **Exceptions** | When it does NOT apply. Write `None` explicitly, never blank. |
| **Owner** | Who decides if this changes |
| **Priority** | 🔴 Critical · 🟡 Important · 🟢 Convention |
| **Example** | A concrete case with real-shaped values |
| **Enforced at** | DB constraint / API / UI / manual — or `NOT ENFORCED` |

> **Never invent a tax rate, threshold, section number or due date.** If you cannot
> cite it, write 🔴 `[OWNER TO CONFIRM]` and stop. A confident wrong number here gets
> coded in, and nobody catches it until a client is affected.
