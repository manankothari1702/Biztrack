# <APP_TITLE>

Identity, how it works, and the decisions behind it.
**Mostly stable** — this changes when the app's shape changes, not when code changes.
Day-to-day history goes in `LOG.md`.

---

## 1. Identity

| Field | Value |
|---|---|
| App name | `<APP>` |
| What it does, in one line | |
| Who uses it | |
| Client | |
| Built on | |
| Target | nas / aws |
| **Exposure** | public / authenticated / VPN only — *decide day one, per `SECURITY.md` §1* |
| Standard version | 3.0 |
| Platform version | |
| State | 🟢 active / 🔵 steady / 🟠 sunset |

## 2. Addresses

| | |
|---|---|
| Public URL | |
| Health check | `<url>/api/health` |
| Repository | |
| Host | |
| Folder on host | |

## 3. Credentials

> Never write a real secret here. Record the password-manager entry name only.

| What | Password manager entry |
|---|---|
| Database password | |
| JWT secret | |
| First admin login | |

## 4. Data model

One line per table on what it holds and why it exists. The columns are in the
migrations — do not restate them here, they will drift.

| Table | Holds | Notes |
|---|---|---|
| `users` | logins | from platform auth |
| `audit_log` | change history | |
| | | |

## 5. How it works ⭐

**The section an AI needs most and people skip most.** Plain-language pseudo-code for
every significant algorithm — anything a reader could not reconstruct from the code
in ten minutes.

```
ALGORITHM: <name>
PURPOSE:   <what it decides, and why that matters to the business>
INPUT:     <what it receives, with types>
OUTPUT:    <what it returns, with types>

STEPS:
  1. ...
  2. FOR each ...
       IF <condition> THEN ...

BUSINESS RULES APPLIED:
  - <rule ID> — <the real-world rule this encodes>

FAILURE MODES:
  - <what happens on bad input, and what the user sees>
```

## 6. Hidden assumptions

What the code takes for granted and would break without. Be paranoid.
*"Assumes one PAN per client." "Assumes the financial year starts in April."
"Assumes amounts arrive pre-rounded to two decimals."*

-
-

## 7. Edge cases NOT handled

Explicitly. **Never imply coverage that does not exist** — an honest "this breaks on
negative amounts" is worth more than silence.

-
-

## 8. Decisions specific to this app

Anything settled here that contradicts or extends a company ADR. Same format:
decision, reason, what was rejected, consequences including the downsides.

## 9. Integrations

External APIs, other apps, shared services. For each: **what breaks if it disappears.**

## 10. Data handling for this client

Required before the first deploy if a client's data is involved (`SECURITY.md` §6).

| | |
|---|---|
| Where data is stored | |
| Who can access it | |
| Backup frequency and location | |
| Retention period | |
| What happens on termination | |
| Restore last tested on | **do not leave this blank** |
