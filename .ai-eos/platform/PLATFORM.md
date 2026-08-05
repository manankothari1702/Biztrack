# PLATFORM

**Contracts every app honours, and the shared code behind some of them.**

Two ideas, and keeping them separate is the point of this file:

| | Definition | Cost to add | Example |
|---|---|---|---|
| **Contract** | A shape every app agrees to. Enforced by `verify.sh`, not by a library. | Near zero | Error responses are `{"detail": "..."}` |
| **Component** | Shared code, versioned, pinned by every app | Real — needs tests, releases, a migration story | The backup sidecar |

**A contract is not a component.** Some contracts have shared code behind them (auth,
backup). Others are pure format agreements that cost nothing and buy fleet-wide
tooling anyway (health, error, logging). *Prefer a contract.* Reach for a component
only when duplicated code would otherwise need patching in a hundred places.

The rule for components: **shared image, isolated instance.** What is shared is the
*code* — versioned, released, pinned. Every *runtime* stays isolated: each app runs
its own copy, its own database, its own container. A bug fix is one change. An outage
is still one app.

Versions and rollout rules: `../VERSION.md`.

---

# THE FIVE CONTRACTS

Every app honours all five. No exceptions, including internal tools and throwaway
prototypes that turn out not to be throwaway.

---

## 1. Health contract — `GET /api/health`

**One endpoint, every app, unauthenticated, never removed.** This is what makes a
hundred apps monitorable by one thing.

```jsonc
// unauthenticated — what the public internet sees
{ "status": "healthy" }                       // 200
{ "status": "degraded" }                      // 200
{ "status": "unhealthy" }                     // 503
```

```jsonc
// with a valid admin token or the monitoring token — what fleet-status.sh sees
{
  "status":         "healthy",       // healthy | degraded | unhealthy
  "app":            "tds",
  "version":        "1.4.2",         // the app
  "platform":       "1.0.0",         // PLATFORM_VERSION
  "standard":       "3.1",           // AI-EOS version
  "database":       "ok",            // ok | slow | down
  "started_at":     "2026-08-01T02:14:33Z",
  "restarts":       0,
  "last_backup_at": "2026-08-03T02:00:11Z",
  "checks_ms":      12
}
```

**Three deliberate choices, each of which the obvious version gets wrong:**

- **Detail is auth-gated.** An unauthenticated endpoint publishing your framework
  version, platform version and dependency state to the internet is free
  reconnaissance for an attacker. The public probe answers the only question a load
  balancer actually asks: is this thing alive? Same path, same contract, richer body
  when the caller is allowed to have it.
- **Fields are machine-readable, not display strings.** `"uptime": "3 days"` has to
  be parsed a hundred times by a script that then has to handle "3 days", "3d", and
  "72 hours". `started_at` as ISO-8601 and `restarts` as an integer do not.
- **`restarts` matters more than uptime.** Low uptime on an old app is the signal you
  actually want, and a restart count says it directly instead of making you infer it.

`status` is `degraded` when the app serves requests but something is wrong — database
slow, last backup older than 48 hours. **`degraded` is the state that saves you**: it
is how you find out about a backup that stopped running three weeks ago, before you
need it.

Never require auth on the shallow probe, never remove the endpoint, never move it,
never let it touch a business table. It must stay cheap enough to poll every thirty
seconds across a hundred apps.

---

## 2. Error contract

Every API error, every app:

```json
{ "detail": "PAN must be 10 characters, e.g. ABCDE1234F" }
```

- `detail` is written for the human reading it at 11pm — which is usually you.
- Never leak schema, file paths, stack traces or SQL. Log those server-side.
- HTTP status carries the category: `400` client error · `401` unauthenticated ·
  `403` authenticated but not permitted · `404` · `409` conflict · `422` validation ·
  `500` ours · `503` dependency down.
- **`403` on a permission failure, never `404` to hide it.** A hundred apps that
  disagree about this are a hundred different debugging experiences.

Pure format agreement. No shared code, and none needed.

---

## 3. Logging contract

Structured JSON to stdout. The container runtime collects it; the app never manages
log files or rotation.

```json
{"ts":"2026-08-03T14:22:01Z","level":"INFO","app":"tds","event":"import.started",
 "user_id":42,"record_id":1180,"msg":"CSV import started, 4,210 rows"}
```

Required on every line: `ts` · `level` · `app` · `event` · `msg`. Include `user_id`
and `record_id` wherever they exist — an error you cannot attribute to a user and a
record costs an hour of guessing.

| Level | For |
|---|---|
| `ERROR` | Something failed and a human must know |
| `WARNING` | Recovered but suspicious — a retry succeeded, a fallback fired |
| `INFO` | Business events: login, import started, backup completed |
| `DEBUG` | Development only. Off in production. |

**Never log a password, a token, a full client record, or a complete request body.**
This is the rule most likely to be broken accidentally by a debugging line that was
never removed, so `verify.sh` greps for the obvious cases.

`event` is a stable dotted name, not prose. Prose changes; `import.started` is
greppable across a hundred apps for the next five years.

---

## 4. Auth contract

One identity across the fleet, authorisation decided per app.

- One account, one password to change, one account to disable.
- **Disabling a user locks them out of every app they had.** This is the requirement
  that justifies shared auth at all — without it, a departed employee at a client
  keeps access to four of their five apps.
- Role names are fixed fleet-wide: `admin` · `manager` · `user` · `readonly`. What
  each may *do* is decided per app at design time and recorded in that app's
  `docs/PROJECT.md` (ADR-019).
- **Every role check is server-side.** A hidden button is not a permission, and
  `verify.sh` proves it by calling each protected endpoint as each lower role.
- JWT bearer tokens, secret per app, rate limiting on login and OTP.

> **Open — `DECISIONS.md` Q-01.** Shared *code* is settled. Shared *runtime* is not.
> A separate auth service gives instant cross-app disable but makes auth a single
> point of failure for the fleet. An embedded library keeps apps independently
> available but needs a central check anyway to make disable immediate. Neither is
> obviously right, which is why it is a decision and not a default. **Write the ADR
> before the platform is built.**

---

## 5. Backup contract

Six endpoints, identical in every app, all requiring `admin`, checked server-side:

| Method | Path | |
|---|---|---|
| `POST` | `/api/admin/backup` | create now |
| `GET` | `/api/admin/backups` | list |
| `GET` | `/api/admin/backups/{file}` | download |
| `DELETE` | `/api/admin/backups/{file}` | delete |
| `POST` | `/api/admin/restore` | restore from selected or uploaded |
| `GET` | `/api/admin/backup/status` | last backup time + health |

An archive contains a `pg_dump`, the `uploads/` folder, and a manifest with app name,
version, timestamp and row counts. Nightly at 02:00. Archives past
`BACKUP_RETENTION_DAYS` are expired. Restore requires typing the word `RESTORE`.
`last_backup_at` is reported on the health endpoint, and an app whose last backup is
older than 48 hours reports `degraded`.

Delivered by the shared sidecar below. **Do not fork it.** If your app needs
something it does not do, change the sidecar — that is the entire point of it.

---

# THE FOUR COMPONENTS

Contracts are cheap. These four cost real maintenance, and each earns it.

| Component | Contract it implements | Why shared rather than duplicated |
|---|---|---|
| **ingress** | — (infrastructure) | Routing, TLS and security headers are identical everywhere. Doing them per app is four manual steps × 100. |
| **backup** | Backup | `BUILD.md` mandates it in every app, so it is proven universal. A bug in duplicated backup code means a hundred edits, which means it never gets fixed. |
| **auth** | Auth | Retrofitting shared identity across built apps means touching every login screen, session model and permission check in all of them. Dramatically cheaper before app #2 than after app #20. |
| **ui-kit** | — (consistency) | A hundred design specs is a hundred chances for the code to disagree with the spec. Shipping tokens as code makes the mismatch impossible rather than forbidden. |

Everything else stays duplicated until three live apps demonstrably share it, in
code, not in plan. Duplication is cheap and reversible; the wrong abstraction is
neither.

### `ingress/`

One reverse proxy per host. Containers declare their route with labels; the proxy
discovers them and obtains certificates itself.

```yaml
services:
  <app>-frontend:
    networks: [<app>-net, edge]
    labels:
      - "app.route.host=tds.example.co.in"
      - "app.route.port=80"
      - "app.route.tls=true"
    # no ports: section. Deliberate. Never add one.
```

The app joins its private `<app>-net` (where it reaches its database) and the shared
`edge` network (where only the proxy reaches it). The database joins `<app>-net`
only, so it is unreachable by construction rather than by remembering not to publish
a port.

Security headers — HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy` — are set
here once for every app. Per app, a hundred times, is a hundred chances to forget one.

> **This is a shared failure domain, accepted deliberately.** Proxy down means every
> app on that host is unreachable. That is the price of deleting four hundred manual
> steps. Keep the config boring, version it, test changes on the staging host first.

### `backup/`

A sidecar beside each app, reaching the database over the private network. Implements
the backup contract above. The admin page comes from `ui-kit`, including the "last
backup: 2 hours ago" indicator that turns red past 48 hours.

### `auth/`

Implements the auth contract. Shape pending Q-01.

### `ui-kit/`

Design tokens for light and dark · the persisting theme toggle · layout shell ·
table with sorting, pagination and CSV/Excel export · forms with inline validation ·
**the four data states as first-class props on every data component** · modals with
a destructive-action confirmation pattern · Admin → Backup and Admin → Users.

**Theming is supported from day one.** A client wanting their own colours sets token
values; they do not fork the kit. If the first branding request causes a fork, the
kit has failed and the fleet fragments back into a hundred one-offs.

Accessibility is built in, not applied per app. A fix here lands everywhere at once —
the strongest single argument for this component existing.

---

## Build order

1. **ingress** — nothing deploys cleanly without it, and it deletes the most manual
   work per app.
2. **ui-kit** — the largest chunk of per-app effort, and what most determines whether
   the apps look like a product line or a hundred one-offs.
3. **auth** — before app #2. After app #20 it is a rewrite.
4. **backup** — last only because the existing per-app module works. Extract before
   app #10, roughly where duplication crosses from cheap to unfixable.

A few focused weeks. **If only one gets built, build ingress. If two, add the ui-kit.**

---

## Deferred, with triggers

**A notification contract.** No app sends notifications, and there is no consumer to
design against. Writing one now is a plugin system without plugins — the exact
pattern this system exists to prevent. **Revisit when** two apps are sending
notifications by hand and their formats have already diverged. Write the contract
*from* those two, not before them.

**Splitting `platform/` into `shared/` · `platform/` · `tooling/`.** Correct
eventually, wrong today — four components do not need three folders, and a folder
created before its contents is a folder that collects the wrong things. **Revisit
when** `platform/` holds more than about six components, or when something lands here
that is clearly a build tool rather than runtime code. Rename all of it in one pass
then; never split it halfway.
