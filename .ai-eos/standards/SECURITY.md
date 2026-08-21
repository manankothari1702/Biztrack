# SECURITY

**Exposure, secrets, access, and what to do when it goes wrong.**

Separate from `BUILD.md` because it is read by a different person at a different
moment — during an audit, during an incident, or when a client asks. Burying it in a
build standard means it is not found when it is needed.

**Index:** §1 exposure · §2 secrets · §3 access · §4 the application baseline ·
§5 dependencies · §6 client data · §7 incident

---

## §1 — EXPOSURE: what may face the internet

| Data the app holds | Allowed exposure |
|---|---|
| Nothing sensitive (calculators, public tools) | Public internet |
| A client's own business data, authenticated | Public internet **with** the platform auth, TLS, rate limiting and audit logging |
| Our clients' clients' financial data | Public internet only if the client contract requires it; otherwise VPN or IP allowlist |
| Anything we hold on behalf of a regulated practice | VPN or allowlist. Not the open internet. |

**Decide this in `docs/PROJECT.md` on day one, and write it down.** An app that
quietly becomes internet-facing three months after launch, because somebody added a
reverse-proxy rule, is the most likely way we cause a breach.

Never expose: database ports (any), `/api/docs` in production, admin backup/restore
endpoints to a non-admin, internal health dashboards.

---

## §2 — SECRETS

| Rule | |
|---|---|
| Real secrets live in `.env` and the password manager. Nowhere else. | Never in a `.md`, never in git, never in a chat window, never in an AI prompt. |
| `.env` is in `.gitignore` from the first commit. `.env.example` has the same keys with fake values. | The scaffold does this; do not undo it. |
| Every app has its own database password and its own JWT secret. | A reused secret turns one compromise into a hundred. |
| Secrets are generated, never chosen. | `openssl rand -base64 32` |
| Rotation: JWT secrets and API keys yearly, or immediately on suspicion. Database passwords only with a planned outage — they are baked into the data directory. | |
| A secret that has ever been in a git history is compromised. | Rotate it. Do not just remove the file. |

**The password manager is a single point of failure for the whole company.** It gets
a second recovery path — see `EMERGENCY.md`.

---

## §3 — ACCESS

Two founders. There is no joiner/mover/leaver process to write, and the old system
had two manuals for one. What actually needs to exist:

- **Both founders have full access to everything.** Anything only one person can
  reach is an outage waiting to happen. `EMERGENCY.md` is the backstop.
- **Client users** are managed inside each app, by that app's admin, using the four
  standard roles. Role *names* are fixed fleet-wide; what each role may *do* is
  decided per app at design time and recorded in that app's `docs/PROJECT.md`.
- **Contractors** get scoped, time-boxed access with a written expiry date, and
  `standards/OPERATE.md` as their manual. Access granted without an end date never
  ends. Revoke on the last working day, not the following week.
- **Quarterly:** run `fleet/scripts/fleet-access-review.sh`. It lists every admin
  account in every app. Confirm each one is still a person who should be an admin.

---

## §4 — THE APPLICATION BASELINE

Enforced by `verify.sh` where a machine can check it, reviewed by
`review/agents/security.md` where it cannot.

1. Role checks server-side on every protected route. A hidden UI button is not a
   permission — a lower role calling the endpoint directly must get 403.
2. Parameterised queries everywhere. No string interpolation into SQL, including
   `ORDER BY` — validate sort columns against an explicit allowlist.
3. Passwords hashed with a modern KDF. JWT secret from the environment.
4. File uploads: content-type and size validated **server-side**, stored outside the
   web root, filename sanitised, never executed.
5. CSV/Excel export escapes formula injection (`=`, `+`, `-`, `@` leading a cell).
6. Rate limiting on login and any OTP endpoint. Logout invalidates server-side state.
7. Error messages leak nothing — no schema, no paths, no stack traces.
8. `is_deleted` filtered on every read path. **A missed filter is a data-exposure
   bug, not a display bug.**
9. Security headers set at the ingress once, for every app: HSTS, CSP,
   `X-Content-Type-Options`, `Referrer-Policy`. Setting these per app a hundred
   times is a hundred chances to forget one.

---

## §5 — DEPENDENCIES

A hundred apps means a hundred dependency trees. This is the maintenance burden most
likely to be quietly abandoned, and abandoning it is how a known CVE stays live for a
year.

- Pin exact versions. Lockfiles committed.
- `fleet/scripts/fleet-audit.sh` runs `pip-audit` and `npm audit` across every app
  monthly and reports only what is above low severity.
- A critical CVE is a `fleet-patch.sh` job, applied to every affected app in one
  pass, verified by each app's `verify.sh`.
- **Prefer fewer dependencies.** Every package added to the scaffold is added to a
  hundred apps. A dependency that saves twenty lines is rarely worth a hundred
  future patches.

---

## §6 — CLIENT DATA

We hold other businesses' data. That changes the stakes from the old internal-tools
posture.

- Each client's data lives in its own database, in its own container, on its own
  host. No shared database, ever. This is what lets us answer "is my data separate
  from theirs?" with a straight yes.
- Backups are encrypted and stored per client. A restore never touches another
  client's data.
- Retention and deletion: when a client leaves, their data is exported to them and
  destroyed on a written schedule. Soft delete is for records inside an app; it is
  not a data-retention policy.
- Written into every client contract before the first deploy: where data is stored,
  who can access it, backup frequency, and what happens on termination. **If we
  cannot answer those four, we are not ready to take the client.**

---

## §7 — INCIDENT

If client data may be exposed:

1. **Contain first.** Take the app offline. An app that is down is a smaller problem
   than an app that is leaking.
2. **Do not delete anything**, including logs. You will need them.
3. **Write down what you know and when you knew it.** Timestamped.
4. Determine scope: which app, which client, what data, what window.
5. Notify the affected client. Indian data-protection obligations and the client's
   own regulatory position may set a deadline — check with counsel, do not guess.
6. Only then, fix.
7. Blameless write-up in that app's `docs/LOG.md`, and an ADR if the cause was
   architectural.

Everything else — NAS dead, ransomware, a founder unavailable — is in `EMERGENCY.md`.
