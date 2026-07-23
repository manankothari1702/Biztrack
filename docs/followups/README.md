# Remediation Follow-Ups

Tracked items left open after the **adversarial security & cost-abuse remediation** (audit
items A1–A2, A3, B1–B4, C1–C4; implemented 2026-07). Everything in the remediation itself is
code-complete and verified by typecheck + logic/semantics simulation + read-only live checks —
**not** by production-load or post-deploy behavioral tests. This file exists so the open items
below don't evaporate.

Legend: each item links back to the remediation item it came from. "Owner action" = not code,
requires a human to run/decide.

---

## ⚠️ P0 — DO NOW (owner action, do regardless of the feature backlog)

### FU-0 · Raise Lambda account concurrency 10 → 1000
**This is a live availability risk, not a backlog item.** Account `346299179287` / ap-south-1
has `ConcurrentExecutions = 10` (AWS new-account floor, never raised). All 9 Lambdas share
those 10 slots, so the per-minute WhatsApp scheduler + a couple of dashboard aggregates + the
daily purge can **exhaust the pool and throttle the whole app with no attacker**. It also
blocks the reserved-concurrency remediation (FU-B1) — at limit 10, any reserved value fails
`cdk deploy`.

```
aws service-quotas request-service-quota-increase \
  --service-code lambda --quota-code L-B99A9384 --desired-value 1000 --region ap-south-1
```
Kick off early — AWS review can take a day or two. Confirm with
`aws lambda get-account-settings`. (From audit B4 / item 3.)

---

## Owner gates — nothing in the remediation is live until these happen

1. **FU-0** (above) — the actual cure for the limit-of-10.
2. **Deploy + run the per-item curl checks against the deployed stack.** All code is verified by
   simulation / read-only checks only; the deploy-gated curl checks (provided per item during
   remediation) are what turn "logic proven" into "works in production." That is the real
   sign-off.
   - Deploy: `cd lambda && npm run build` → `cd infra && npx cdk deploy`.
   - **Do not reach for `-c env=dev` to develop locally.** It mutates this same prod stack and
     widens the live CORS allowlist for as long as it stays deployed. Use the Vite dev proxy
     instead — see FU-B6 and the root `README.md`.

---

## Group A — "UI must catch up" (backend is honest, but the fix is only HALF-REAL to users until the UI lands)

Each backend change already reports the truth; the UI still implies full success. Ship these
close to their backend counterparts.

### FU-A1 · Import summary must reflect backend `imported` / `failed` / `timedOut`  → item 5 (B2)
`POST /clients/bulk` now returns `{ imported, requested, failed, timedOut }` (imported = rows
actually persisted after UnprocessedItems retries + wall-clock guard). The import modal ignores
the response and computes its summary client-side.
- Files: `src/features/clients/hooks/useClients.ts` (bulkAddClients — return the response);
  `src/features/clients/components/ImportPreviewModal.tsx` (handleConfirmImport ~250-284, summary
  screen ~288-326).
- **Acceptance:** the summary reflects the BACKEND's imported/failed/timedOut, never a
  client-side assumption of full success; when `imported < requested` the user sees the real
  imported AND failed counts; when `timedOut`, a "import truncated — re-run to finish" warning.

### FU-A2 · Surface org-delete partials  → item 6 (B3)
`DELETE /user/org/{id}` deletes the whole subtree and returns `{ deletedIds, requested, partial }`.
The UI shows a blanket "removed" toast; on `partial` the remainder lingers until the 30s poll.
- Files: `src/shared/context/DataContext.tsx` (deleteOrgNode — expose `partial`);
  `src/features/team/pages/Team.tsx` (handleConfirmDelete toast).
- **Acceptance:** on `partial === true` the user is told the delete was incomplete and to retry;
  full success unchanged.

### FU-A3 · Approaching-cap warning banner  → item 4 (B1) / item 6 (B3)
Client cap = 25,000, org-node cap = 2,000, enforced server-side with a hard 403 at the ceiling.
No "you're near the limit" signal.
- Needs the current count surfaced in a response (add `clientCount` / `orgNodeCount` to the
  clients/dashboard/user payloads), then a banner at ≥90%.
- **Acceptance:** user sees a non-blocking warning approaching the cap; the hard 403 at the
  ceiling remains the backstop.

### FU-A4 · Default timezone + gate the report toggle  → item 1 (A2)
Backend now requires a valid HH:MM `reportGenerationTime` + valid IANA `timezone` to enable
reports (400 otherwise). The profile UI only persists a timezone when the dropdown is changed,
so toggling reports on from a fresh profile 400s with a generic toast.
- Files: `src/features/profile/pages/Profile.tsx` (handleToggleReport ~186-193; timezone
  default/persist ~195-202, ~504).
- **Acceptance:** enabling reports from a fresh profile succeeds without manual timezone
  selection (default to `Intl.DateTimeFormat().resolvedOptions().timeZone`); disabling always
  succeeds; a genuine block shows a specific message, not the generic failure toast.

---

## Group B — deferred backlog (feature/infra work, not gating correctness)

### FU-B1 · Enable Phase C reserved concurrency  → item 3 (B4)
Written and flag-gated OFF (`cdk deploy -c reserveConcurrency=true`). Enable **only after FU-0**
raises the quota (≥300). Before enabling, recompute the per-function numbers against the ACTUAL
confirmed limit and re-verify `sum(reserved) ≤ limit − 100`. The plan now sums to **239** — it
was 179 before the inventory handlers added products 30, batches 20, stockMovements 10.
Optionally then loosen the Phase B throttles toward the in-code targets.

### FU-B2 · Cognito MFA rollout  → item 7 (C2)
Proposal-only; pool untouched. Optional-but-unprompted MFA buys little — recommended: a
prompt-to-enable TOTP flow. Required MFA forces enrollment on every existing user's next login
(a planned, communicated support event). Scope: pool MFA config, enrollment UI
(setUpTOTP/verifyTOTP), login challenge step, recovery. Decide the rollout mode before touching
the pool.

### FU-B3 · Async bulk import (SQS/Step Functions)  → item 5 (B2)
Only if real large-import demand appears. Current sync path (5,000/request + retry + 20s
wall-clock guard) is right for this scale and competes for the scarce 10 concurrency slots until
FU-0.

### FU-B4 · Phone-ownership verification  → item 1 (A1)
The "strong" A1 option, deferred. Add `phone_number` as a Cognito attribute + SMS verification,
then require the stored number to equal the verified claim. Fully closes the "send to an
arbitrary number" path (today mitigated by format-validation + the 10/day, 1/hr rate cap).

### FU-B5 · Move profile photos to S3 + presigned URLs  → item 2 (A3)
Item 2 caps photos at 200KB server-side, but they still ride inside every `GET /user` (incl. the
30s poll). S3 + presigned URLs removes the base64-in-DynamoDB class entirely (infra + client
upload rewrite + migration of existing base64/Google-URL photos).

### FU-B6 · Separate dev stack  → from the C3 CORS lockdown

**Status: deferred, will be implemented.** Not a "maybe" — the current setup has no dev
environment at all. One CloudFormation stack (`BiztrackStack`), one API Gateway stage (`prod`),
one DynamoDB table (`biztrack`), one Cognito pool (`biztrack-users`). Local development runs
against production.

**Trigger — implement when any of these becomes true:**
- a second developer joins (a shared prod table stops being merely untidy);
- local testing needs to write freely without touching prod data (destructive tests, seeding,
  migration rehearsals);
- prod uptime starts mattering enough that iterating against it is unacceptable.

**Blocked on:** parameterizing the hardcoded physical names in `infra/lib/biztrack-stack.ts`.
Two stacks cannot coexist in one account/region while these are fixed strings:

| What | Current value |
|------|---------------|
| `tableName` | `biztrack` |
| `userPoolName` | `biztrack-users` |
| `domainPrefix` | `biztrack-auth` |
| `restApiName` | `biztrack-api` |
| `functionName` ×11 | `biztrack-post-confirmation`, `-clients`, `-tasks`, `-products`, `-batches`, `-stock-movements`, `-dashboard`, `-user`, `-whatsapp-scheduler`, `-whatsapp-test`, `-purge-accounts` |
| `ruleName` ×2 | `biztrack-whatsapp-every-minute`, `biztrack-purge-accounts-daily` |
| `bucketName` | `biztrack-frontend-${account}` (account-scoped, so identical across stacks) |

Also needed: an env-suffixed stack id in `infra/bin/infra.ts` (currently the literal
`'BiztrackStack'`).

**⚠️ Hazard — the reason this needs care, not just effort.** `env=prod` must resolve to the
**exact** current strings. Any drift — a suffix, a case change, a stray hyphen — is a physical
name change, and CloudFormation implements that as **replace**, not rename. For the table that
means a new empty `biztrack-prod` alongside the old one; `RemovalPolicy.RETAIN` would orphan the
real data rather than delete it, but the app comes up empty and the rollback is manual. Same
class of risk for the Cognito pool (`RETAIN`, and users are not portable between pools).
Verify with `cdk diff` that the prod path shows **no** change to any physical name before
deploying the parameterization.

**Interim (in place today):** Vite dev proxy + a dedicated Cognito dev user. The proxy
(`server.proxy` in `vite.config.ts`, enabled by `VITE_API_URL=/api` in a gitignored
`.env.local`) keeps the browser same-origin so the C3 allowlist is never involved. The dev user
gives real data isolation without a second table, because every row is keyed `PK = USER#<uid>`
from the verified token. See the **Local development** section of the root `README.md`.

> Note: `-c env=dev` exists on the stack but is **not** the interim answer. It mutates the same
> prod stack and would widen the live allowlist for the duration — see the deploy note in
> "Owner gates" above.

### FU-B8 · gstack upgrade + skipped setup prompts  → tooling, surfaced 2026-07-23

**Not blocking anything.** Deferred until Phase 3 closes, to avoid changing tooling
mid-build.

`gstack-update-check` reports **1.42.2.0 → 1.60.1.0** available. Upgrade with
`/gstack-upgrade` (or read `~/.claude/skills/gstack/gstack-upgrade/SKILL.md`).

The `/browse` preamble also queues one-time setup prompts that were skipped rather than
interrupting the build with five config questions. They will reappear on the next gstack
skill invocation:

| Prompt | State | Effect if left alone |
|--------|-------|----------------------|
| Telemetry opt-in | unanswered (`TELEMETRY: off`) | stays off |
| Proactive skill suggestions | unanswered | stays on (default) |
| Skill routing rules in `CLAUDE.md` | declined-by-omission | skills still work; must be invoked explicitly |
| "Boil the Lake" intro | unseen | cosmetic |

One side effect already landed: the browse tooling appended `.gstack/` to the repo's
`.gitignore`. Correct (gstack state should not be committed) but authored by the tool, not
by a person — left uncommitted for a human to accept.

### FU-B7 · `axios` / `form-data` advisories in `lambda/`  → pre-existing, surfaced 2026-07-22

`npm audit --omit=dev` in `lambda/` reports **2 high** advisories in **production** dependencies:

- **`axios` 1.0.0–1.17.0** — ten advisories: DoS via recursion in `formDataToJSON`, prototype
  pollution (auth subfields / request construction / nested options), `maxBodyLength` bypasses
  (fetch `ReadableStream`, HTTP/2 streamed uploads), `NO_PROXY` bypass for `0.0.0.0`, proxy
  inherited after interceptor config cloning, form serializer `maxDepth` bypass.
- **`form-data` 4.0.0–4.0.5** — CRLF injection via unescaped multipart field names/filenames
  (transitive, via axios).

Used only by `whatsappScheduler.ts` and `whatsappTest.ts`, which POST a fixed JSON body to the
Meta Graph API — no multipart, no user-controlled proxy config, no form serialization. So
exposure is low, but these are shipped production deps, not dev tooling.

`npm audit fix` claims a fix is available. **Not applied**: bumping a dependency that eight live
Lambdas load is its own change with its own deploy and verification, and it was out of scope of
the work that surfaced it. Do it as a standalone commit: bump, `npm run build`, `npm test`,
deploy, then invoke `biztrack-whatsapp-test` to confirm the Graph API call still works.

---

## Pre-existing bugs — from the ORIGINAL code review, NOT introduced or owned by this security remediation

Flagged in passing while touching nearby code. Listed here so they aren't lost; they predate and
are out of scope of the security/cost pass.

- **Tasks status/priority filter `:prefix` ValidationException** (`lambda/src/tasks.ts` status/
  priority branch) — seeds an unused `:prefix` value → `GET /tasks?status=…` 500s. (The new
  calendar range path deliberately avoids this branch.)
- **Import "Update" creates duplicates** — `validateClientRow` assigns a fresh UUID per parse and
  bulkAdd always inserts, so a duplicate "Update" row inserts a second record instead of updating.
- **Cognito callbackURL/logoutURL hardcode + localhost** (`infra/lib/biztrack-stack.ts`) — the
  OAuth redirect URLs hardcode the CloudFront domain and always include localhost. Now that
  CloudFront is created before Cognito would need to be for a clean fix; could align to
  `distribution.distributionDomainName` and env-gate localhost (as CORS now does).
- **Legacy un-sharded `reportSchedule` rows** — any rows written before the item-1 GSI5 shard fix
  (`reportSchedulePK = 'REPORT_SCHEDULE'`) should be cleaned up / re-derived; fold into the
  separate scheduler-fix item (the scheduler read-side is intentionally still dormant per the
  item-1 scope decision).
