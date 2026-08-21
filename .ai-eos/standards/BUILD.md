# BUILD STANDARD

**How every app is built.** Capped at 12 sections — see §12 before changing this file.

| § | | § | |
|---|---|---|---|
| 1 | Stack | 7 | Frontend |
| 2 | Project layout | 8 | Code standard |
| 3 | Configuration | 9 | Performance budgets |
| 4 | Database | 10 | Testing |
| 5 | API | 11 | Migrating an app to a newer standard |
| 6 | Compatibility rule | 12 | **Amendment rule** |

Companions: `DOMAIN-INDIA.md` (business truth) · `DECISIONS.md` (read before
overturning anything here) · `platform/PLATFORM.md` (what you must not rebuild).

---

## 1. STACK

| Item | Value |
|---|---|
| Runtime | Docker + Compose. Nothing installed on a host directly. |
| Database | PostgreSQL 16, one dedicated container per app |
| Backend | Python 3.12 + FastAPI |
| Frontend | React, built to static files, served by `nginx:alpine` |
| Ingress | One shared reverse proxy, label-routed. Apps publish **no host ports**. |
| Timezone | `Asia/Kolkata` in every container |
| Dev / internal target | Synology DS923+ NAS |
| Client-facing target | AWS (or VPS). Same compose file, different target. |

**Every app is self-contained.** Own database container, own network, own folder,
own repository. If one app dies, the other ninety-nine do not notice.

The stack is fixed on purpose. A second language or framework in the fleet doubles
what two people must keep patched, and buys nothing an AI cannot already write well
in Python and React.

---

## 2. PROJECT LAYOUT

Produced by `fleet/scripts/new-app.sh`. Do not create it by hand.

```
<app>/
├── .ai-eos/                 the standard, vendored + version-pinned. Read-only.
├── .githooks/pre-commit     runs verify.sh --fast
├── docker-compose.yml       stack definition, ingress labels, platform pins
├── .env                     real secrets — never committed
├── .env.example             same keys, fake values
├── verify.sh                the release gate. Runs in CI and locally.
├── AGENTS.md                project context — MUST be at root (auto-load), imports .ai-eos/
├── CLAUDE.md / GEMINI.md    one line each: @AGENTS.md
│
├── docs/
│   ├── PROJECT.md           identity + how it works + decisions. Mostly stable.
│   ├── RULES.md             business rules THIS app owns
│   └── LOG.md               append-only. One entry per completed feature.
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── migrations/          numbered, forward-only SQL
│   ├── tests/
│   └── app/
│       ├── main.py  config.py  database.py  models.py
│       └── routers/
├── frontend/
└── nginx/default.conf
```

**Three documents per app, not four.** `PROJECT.md` absorbed the old
`APP-README.md` and the parts of `MANUAL.md` that do not rot. The old
`dashboard-spec.md` is gone — there is one design system for the whole fleet
(`platform/ui-kit`), not one spec per app.

`.ai-eos/` is vendored rather than referenced so the repo is self-contained and pins a
known standard version. **Never hand-edit it inside a project** — fix the source and
re-run `fleet-patch.sh`, or that app silently forks the standard. `AGENTS.md` stays at
the root because that is where every AI tool auto-loads from; putting the only copy
inside `.ai-eos/` disables the mechanism entirely.

Adopting an existing project into this layout is a different job with different rules:
`../MIGRATION.md`.

Throwaway scripts are exempt from all of this.

---

## 3. CONFIGURATION

Same variable names in every app, so nothing ever surprises you at 11pm.

```ini
APP_NAME=tds
APP_TITLE=TDS Reconciliation
APP_DOMAIN=tds.example.co.in

POSTGRES_DB=tdsdb
POSTGRES_USER=tdsuser
POSTGRES_PASSWORD=<openssl rand -base64 24>

JWT_SECRET=<openssl rand -base64 32>
JWT_EXPIRE_HOURS=12
AUTH_ISSUER=https://auth.<company-domain>

ADMIN_EMAIL=
ADMIN_PASSWORD=<change on first login>

TZ=Asia/Kolkata
BACKUP_RETENTION_DAYS=30
PLATFORM_VERSION=1.0.0
```

Config is read **once**, in `config.py`, from the environment. Never `os.getenv`
in the middle of a function.

> **The Postgres password is baked into the data directory on first startup.**
> Changing it in `.env` afterwards does not change the database — it only breaks
> the backend's login. Generate it once, save it to the password manager
> immediately, never rotate it casually.

**No host ports.** Ingress routes by Docker label (`platform/PLATFORM.md`). There
is no port register and no port allocation step. This is deliberate — hand-managed
port blocks were survivable at six apps and are not at a hundred.

---

## 4. DATABASE

PostgreSQL 16. Data on a named volume or bind mount that survives container
deletion.

### Every table

```sql
id          BIGSERIAL PRIMARY KEY,
created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
created_by  BIGINT REFERENCES users(id),
is_deleted  BOOLEAN NOT NULL DEFAULT FALSE
```

### Types

| Data | Type | Why |
|---|---|---|
| Money | `NUMERIC(18,2)` | Never float. Floats lose paise. |
| Dates | `DATE` | |
| Timestamps | `TIMESTAMPTZ` | Always with zone |
| PAN / GSTIN / TAN | `VARCHAR` + `CHECK` on format | Catch typos at the database |
| Financial year | `fy VARCHAR(7)` e.g. `2025-26` | On every transactional table |

### Rules

- **Soft delete only.** Reads go through a base query that filters
  `is_deleted = false` by default. Never rely on remembering the filter.
- Unique constraints must account for soft-deleted rows still holding their value.
  Use a partial index: `UNIQUE (pan) WHERE is_deleted = false`.
- Every app has `users` and `audit_log`.
- Index every foreign key and every filtered column. Verify with `EXPLAIN ANALYZE`,
  do not assume.

### Migrations

Numbered, forward-only SQL in `backend/migrations/`. Applied on startup, recorded
in a `schema_migrations` table. **No ORM auto-migration.** A migration that ran on
a client's live database must never be edited — write a new one.

---

## 5. API

- All routes under `/api/`. JWT bearer auth. Errors as
  `{"detail": "human readable message"}` — the human reading it at 11pm is you.
- **`GET /api/health` — the fleet contract. Every app, no exceptions, never removed.**
  Unauthenticated callers get `{"status":"healthy"}`; authorised callers get app
  version, platform version, standard version, database state, restart count and last
  backup time. Full shape and the reasoning: `platform/PLATFORM.md` § Health contract.
  There is no separate `/api/version` — one endpoint is what makes a hundred apps
  monitorable by one thing.
- Auth endpoints come from the platform auth package, not hand-written per app.
- Backup endpoints come from the platform backup sidecar, not hand-written per app.
- FastAPI docs at `/api/docs` — admin-only or disabled in production.
- **Routers hold HTTP concerns only.** Parse, validate, authorise, call, respond.
  Business logic lives in service functions callable without HTTP.
- **The frontend never contains a business rule.** If backend and UI both compute a
  tax figure they will disagree eventually, and the UI will be the wrong one.

---

## 6. COMPATIBILITY RULE

> **Never break a working API or schema without all four of these.
> "It's only used internally" is exactly when this gets skipped and exactly when it hurts.**

1. **Keep the old path working**, or move it to `/api/v1/` while the new lives at `/api/v2/`.
2. **Write the migration path** for every caller, and test it.
3. **Record it** — an ADR in `standards/DECISIONS.md` if it is architectural, otherwise
   a `docs/LOG.md` entry naming the deprecation date.
4. **Deprecate, do not delete.** Keep it working for one full financial year, then remove.

**Breaking means:** removing an endpoint or field · renaming anything · changing a
type · making an optional field required · changing the meaning of a value ·
tightening validation on existing data · changing an error shape · dropping a column.

A client-facing app's callers include a scheduled script, a saved Excel query, and a
reconciliation somebody runs once a year. The rule costs an hour. Skipping it costs
a filing season.

---

## 7. FRONTEND

Build with `platform/ui-kit`. It ships the tokens, the four data states, the theme
toggle, the table with export, and the admin pages. **Do not restyle it per app** —
one design system across the fleet is the only version of this that two people can
maintain. An app may add components; it may not fork the kit.

The floor every screen clears — a floor, never a ceiling:

- Light + dark mode, toggle persists across reloads.
- **All four states on every data view:** normal, empty, loading, error. The empty
  state is the first thing a new user sees; the error state is the one they remember.
- Keyboard navigable, visible focus, correct ARIA, WCAG AA contrast in both themes.
- Responsive to 375px. Sidebar collapses.
- Amounts `Rs 12,34,567.00`. Dates `DD-MM-YYYY`. Export to CSV/Excel on every table.
- Professional, not flashy. No heavy gradients, no oversized headings, no clutter,
  no arbitrary colours — the generic-AI look is a defect, not a style.

If a request would fall below this line, say so before building rather than quietly
skipping it.

---

## 8. CODE STANDARD

An AI given no conventions invents a different one every session, and a hundred apps
in a hundred styles is a fleet nobody can review.

| Rule | Limit |
|---|---|
| Function length | 50 lines |
| Nesting depth | 3 |
| Parameters | 5 |
| File length | 500 lines |

Exceeding a limit is not forbidden — it is a prompt to ask whether extracting would
help. Usually it would.

- Python `snake_case` / `PascalCase` classes. React `PascalCase` components.
  Database `snake_case`, plural tables, singular columns.
- Booleans read as assertions: `is_deleted`, `has_pan`, `can_edit`.
- **No magic numbers.** Rates, thresholds and tolerances are business rules — named
  constant or database row, cross-referenced to a rule ID.
- Comment **why**, not what. Every function touching a business rule cites the rule
  ID, so someone changing that rule in two years finds every implementation.
- **Never swallow an exception.** `except: pass` is prohibited. Catch specific
  exceptions. Log with context: what was attempted, for which record, by which user.
- Never leak schema, paths or stack traces to a user.
- Logging follows the logging contract — structured JSON to stdout, stable dotted
  `event` names, `user_id` and `record_id` wherever they exist. **Never log a
  password, a token, or a full client record.** `platform/PLATFORM.md` § Logging.

### The Rule of Three

**Never abstract after one use. Rarely after two. Consider it at three.**

One instance is an implementation. Two is a coincidence — and the second one usually
differs from the first in a way you have not noticed yet. Three is a pattern, and by
then you can see which parts actually vary.

Abstracting at one or two is the single most common way an AI-written codebase
acquires structure nobody needs, because at that point the abstraction is designed
from imagination rather than from evidence. **Duplicate it and wait.** Duplication is
cheap and reversible; the wrong abstraction is neither, because every later feature
bends around it.

Before creating any abstraction, helper, service, repository, factory, interface,
manager or utility, ask: **"Does this immediately reduce maintenance?"** Not "will it
one day" — immediately. If the answer is no, do not create it.

This is the same principle ADR-015 and ADR-023 apply to the platform, at the scale of
a single file: extract from evidence, never from prediction.

### What not to build

No wrapper functions around a single call. No repository for one table. No factory
for one implementation. No interface for one class. No plugin system without
plugins. No config option that is never varied. No abstraction layer where a plain
function is equally correct and easier to read.

Future-proof deployment, configuration, auth, backups, logging, migrations and
folder structure. Do not future-proof application code.

---

## 9. PERFORMANCE BUDGETS

Numbers, so the gate is testable rather than a matter of opinion.

| Metric | Budget |
|---|---|
| `GET /api/health` | < 100 ms |
| List endpoint (≤ 100 rows) | < 500 ms |
| Any single query | < 200 ms (`EXPLAIN ANALYZE`) |
| Report / reconciliation run | < 5 s, or async with progress |
| First contentful paint | < 1.5 s |
| JS bundle, gzipped | < 500 KB |
| Backup of a 100 MB database | < 60 s |

Rules that keep you inside them: paginate everything (default 50, max 200) · index
every FK and filtered column · no N+1 · lazy-load admin routes · over 5 seconds
becomes a background job with progress · gzip on · **test with 50,000 rows, not 20.**

Missed a budget? Find the cause. Nine times in ten it is a missing index or an N+1,
both twenty-minute fixes. Do not widen the budget.

---

## 10. TESTING

The old standard had no testing section. At six apps you can click through them. At
a hundred you cannot, and an untested fleet is a fleet you dare not patch — which
means it stops being patched, which is how a security fix goes unapplied for a year.

**Minimum per app, enforced by `verify.sh`:**

| Test | Why it is mandatory |
|---|---|
| `test_money_precision` | Sum 1,000 rows; compare to an exact decimal total. Catches any float that crept in. |
| `test_soft_delete_hidden` | Soft-delete a record; assert it is absent from every list **and every total**. |
| `test_role_boundaries` | For each role, call each protected endpoint directly. A lower role must get 403 — not a hidden button. |
| `test_audit_written` | Create, update, delete; assert three `audit_log` rows. |
| `test_backup_restore` | Back up, wipe, restore, compare row counts. An unrestored backup is a file, not a safety net. |
| Happy path per endpoint | |
| Boundary cases | FY boundaries (31-03, 01-04), quarter boundaries, empty input, maximum input |

CI runs `verify.sh` on every push; `verify.sh --fast` runs pre-commit in seconds. A
red result blocks a deploy — that is the whole gate mechanism, replacing twelve manual
checkboxes nobody has time to walk through a hundred times.

`verify.sh` is expected to grow, and there is one intended source of growth: **every
review finding a script could have caught becomes a new check** (`review/SHARED_RULES.md`
§ The ratchet). That is also the cheapest way to free space in `AGENTS.md` — a rule a
script enforces no longer needs to sit in the context window.

**`verify.sh` belongs to the standard, not to the app.** It ships with the scaffold
and is updated fleet-wide by `fleet-patch.sh`, so a new check written once reaches a
hundred apps. App-specific checks go below the `APP CHECKS` marker, which upgrades
preserve. Treat it with the same care as platform code: a bug in it silently passes
bad builds.

---

## 11. MIGRATING AN APP TO A NEWER STANDARD

Apps do **not** auto-upgrade. Each records its standard and platform version in
`docs/PROJECT.md` and keeps working on it.

| Change type | Action |
|---|---|
| Security fix | **Immediately, every app.** Use `fleet/scripts/fleet-patch.sh`. |
| Business rule change | **Immediately, every affected app.** Correctness, not tidiness. |
| Platform minor version | At the next substantial work on that app |
| Convention change | Only if the app is being reworked anyway |
| New optional capability | Never, unless wanted |

**Do not migrate a working app for tidiness.** A live documented app on an older
version beats the same app half-migrated with two days of unrelated risk attached.

Procedure: back up → read every version-history row between the app's version and
the target → list what actually applies (most rows will not) → one change at a time,
verifying between each → `./verify.sh` → `docs/LOG.md` entry.

---

## 12. AMENDMENT RULE

> **This standard is capped at 12 sections. New versions REPLACE. They do not append.**

Left alone, a standard grows: 600 lines → 900 → 1,800. At some point nobody reads
it, and an unread standard is worse than none, because people believe it is being
followed.

Every amendment must **replace** an old rule (delete the old text), **tighten** an
existing rule without making it longer, or **remove** a rule that stopped earning
its place. Adding a section because something feels missing, without removing or
replacing anything, is not allowed.

Before any change, answer:

1. What does this remove or replace?
2. If nothing — what value does it create, concretely, over five years and a hundred apps?
3. Can it be tightened into an existing section instead of becoming a new one?
4. Does it belong in `DOMAIN-INDIA.md` (a business fact) or `fleet/REGISTRY.md` (an
   operational fact) rather than here?

A 13th section means one of the existing 12 must go. That constraint is the point.

### The same rule, applied to `AGENTS.md`

`AGENTS.md` is capped at **3,400 characters** and is the highest-risk file in the
system, because it is the one everything reads and the one every new rule wants to
join. Its amendment rule lives *here*, in a file nobody loads at runtime, so that
protecting the budget does not consume it.

**A rule belongs in `AGENTS.md` only if both are true:**

1. **Violating it produces code that looks correct and passes review.** Money as a
   float looks fine. A missed `is_deleted` filter looks fine. A permission check in
   the UI instead of the server looks fine. These are the failures a reader cannot
   see, which is why they must be in front of the AI before it writes a line.
2. **It applies to every app.** Anything conditional, staged or domain-specific
   belongs in `BUILD.md`, `SECURITY.md` or `DOMAIN-INDIA.md`.

Everything else goes in a standard and is reached through the task table. **The task
table is the point of `AGENTS.md` — it is an index, not an encyclopedia.** A rule
that needs a paragraph to explain has already failed test 1.

**When the budget is hit, something leaves.** The budget does not move. Raising it is
the easy decision that is wrong every time — 3,400 becomes 5,000 becomes 12,000, and
at that size it stops being read carefully and the whole mechanism inverts. Ask what
the *weakest* existing rule is; there is almost always one that has become obvious to
everyone, or that `verify.sh` now catches automatically. **A rule a script enforces
does not need to be in the context window** — that is the cheapest way to make room,
and it gets cheaper as `verify.sh` grows.

`fleet-status.sh` asserts the budget on every run, so it cannot drift unnoticed.

---

## VERSION HISTORY

Not here. **All version numbers and migration notes live in `../VERSION.md`** — one
place, so an app on an older standard has one thing to read rather than three tables
to diff.
