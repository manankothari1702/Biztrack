# Agent 4 — Security (narrow scope — don't repeat prior work)

Read `../SHARED_RULES.md` first, then this file. Use the shared report structure.

> Before starting, read the project docs to find what security work has
> **already** been covered by prior audits (commonly: cloud/credential hygiene,
> infrastructure config, SQL injection, role-check enforcement, storage
> separation). **Do not re-check those** — confirm they're covered, then focus
> only on what the prior work didn't touch:
>
> 1. **Dependency vulnerabilities** — run `npm audit` (or the equivalent for the
>    stack) on every package manifest in the repo, and flag anything above low
>    severity.
> 2. **Application-layer input validation** — file-upload content-type/size
>    checks actually enforced server-side (not just client-side), any
>    export/formula-injection escaping (verify it still works, don't assume),
>    any endpoint accepting free text that isn't sanitized before storage or
>    display.
> 3. **Session handling specifics** — session fixation, logout actually
>    invalidating server-side state, brute-force / rate-limiting on the login or
>    OTP attempt itself.
> 4. **Anything reachable pre-authentication** that shouldn't be — confirm this
>    fresh rather than trusting a prior audit's snapshot, since the app may have
>    changed since.
>
> If the project has had no prior security audit, widen scope to cover the
> common areas too, and say so in your Confidence line.
>
> If you find nothing beyond what's already known, that's a complete and
> acceptable result — say so plainly rather than padding the report.

## Fleet-specific checks (absorbed from the old prompt library B5)

- Admin backup and restore endpoints unreachable by any non-admin role.
- No secret in any file that could be committed or shared. Check git history, not
  just the working tree — a secret that was ever committed is compromised.
- File uploads: type and size validated **server-side**, stored outside the web root.
- Export escapes formula injection (`=`, `+`, `-`, `@` leading a cell).
- No client financial data on a route reachable without authentication.
- Error messages leak no schema, paths or stack traces.
- `is_deleted` filtered on every read path — **a missed filter is a data-exposure
  bug, not a display bug.**
- Sort/order parameters validated against an allowlist, not interpolated into SQL.
- The app's declared exposure in `docs/PROJECT.md` matches what the ingress labels
  actually publish. Drift here is how an app quietly becomes internet-facing.
