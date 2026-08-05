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

## Group EOS — opened by the AI-EOS adoption, 2026-08-05

Adoption was scoped to categories 1–3 (documentation, tooling, observability) and
stopped there deliberately. These are the items it surfaced but did not do. Full
context: `docs/PROJECT.md` §8 and the adoption entry in `docs/LOG.md`.

### FU-EOS-1 · Hard delete of business records  → PROJECT.md §8 D-01 · 🔴 P1
**The company standard says soft delete only; this app deletes for real.** There is no
`is_deleted` flag and no undo — a mis-clicked delete is permanent data loss for the
owner's own CRM.

Call sites: [`lambda/src/clients.ts:258`](../../lambda/src/clients.ts#L258) ·
[`lambda/src/products.ts:322`](../../lambda/src/products.ts#L322) ·
[`lambda/src/tasks.ts:186`](../../lambda/src/tasks.ts#L186).
Finalized invoices are already safe — they are part of the audit trail and only
drafts can be deleted (BR-BIZ-005).

**Why it was not done during adoption:** retrofitting `is_deleted` touches every read,
query, count, export and dashboard aggregate in the app — a feature-sized change, and
`MIGRATION.md` is explicit that adoption is not where that belongs. **This is a
deferral, not an approval.**

Do it one entity at a time, not one commit. Suggested order: clients (highest value,
most painful to lose), then products, then tasks. Each entity needs: the flag on
write, `is_deleted = false` on every read path **including totals and Excel exports**,
and a test that a deleted record is genuinely hidden from a list, a count and an
export. The dashboard aggregates are the easiest place to get this wrong.

### FU-EOS-2 · A DynamoDB restore has never been tested  → PROJECT.md §10 · 🔴 P1
PITR is enabled and the table is `RETAIN`, so the backup side is sound. Nobody has ever
restored from it. **An unrestored backup is a file, not a safety net** — the failure
mode is discovering at the worst possible moment that the restore path has a step
nobody knows.

Owner action, roughly an hour: restore the table to a new name at a timestamp a few
minutes old, point nothing at it, confirm a handful of known rows are present, then
delete the restored table. Record the date in `docs/PROJECT.md` §10 — the field is
deliberately marked 🔴 NEVER until this happens.

### FU-EOS-3 · No Content-Security-Policy  → PROJECT.md §8 D-05 · 🟡 P2
The AI-EOS adoption added HSTS, `X-Content-Type-Options`, a referrer policy and
`X-Frame-Options` to the CloudFront distribution, which previously set **no security
headers at all**. CSP was deliberately left out: a wrong CSP breaks a live SPA
silently — a blank page whose only clue is in the browser console.

Do it in the safe order: ship `Content-Security-Policy-Report-Only` with a report
endpoint, watch real traffic for a week (Cognito Hosted UI redirects and the FontAwesome
/ ExcelJS bundles are the likely violations), then promote to enforcing. `verify.sh`
already checks for the header and currently skips it with this reason.

### FU-EOS-4 · `npm run lint` is red — 15 errors  → 🟡 P2
Pre-existing, recorded in the adoption baseline (commit `c94fd0e`), **not** introduced
by adoption. Unused `catch` bindings in `dateUtils.ts`, three `no-explicit-any` in
`excelUtils.ts`, and a `react-hooks/immutability` error in the data context.

This is the one blocking the pre-commit hook: `.githooks/pre-commit` exists but is
deliberately **not enabled**, because turning it on while `verify.sh --fast` is red
would block every commit and teach everyone to reach for `--no-verify`. Fix the 15
errors, then run `git config core.hooksPath .githooks` and the gate becomes automatic.

### FU-EOS-5 · Stale artefacts still tracked in git  → 🟢 P3
`.gitignore` now ignores them, but these were already committed and remain in the repo:
`lint_report.json` (587 KB), `lint_log.txt`, `lint_output.txt`, `output.txt`,
`repro_bug.ts`, `.firebase/hosting.ZGlzdA.cache` (left over from the pre-AWS backend),
and two `.docx` interview files. Adoption did **not** delete them — removing files is
the owner's call, not a side effect of a standards pass. `git rm --cached` whichever
are genuinely dead.

### FU-EOS-6 · ~~No monitoring or alerting of any kind~~ — RESOLVED 2026-08-05

**Done and deployed** (`8a0b5d1`, deployed 13:23 UTC; write-up in `docs/LOG.md`).

The account had **zero alarms, zero SNS topics and zero dashboards**. That is how
`biztrack-whatsapp-scheduler` failed 4,320 times a day for at least 31 days with
nobody knowing, and how the tasks `:prefix` bug 500'd every filtered query until a
human read the code.

Now live: five alarms on `biztrack-alerts` (API 5XX, account-wide Lambda errors,
account-wide Lambda throttles, DynamoDB throttle events, and the daily purge going
silent), one dashboard, and a `verify.sh` guard that fails while the alert topic has
no **confirmed** subscriber. ~$0.60/month. Rules recorded as `BR-BIZ-E05` and
`BR-BIZ-E06` in `docs/RULES.md`.

Owner actions completed 2026-08-05: SNS subscription confirmed, AWS billing alerts
enabled (`AWS/Billing` now publishes, including the `Currency`-only series the
dashboard widget queries), and an external uptime monitor configured against
`HealthUrl` — Decision B1, the independent check no in-account alarm can provide.

**Two things here will go stale silently, so they are written down rather than
trusted to memory** (both also in `BR-BIZ-E06`):
- Thresholds of `1` are right at ~4,300 invocations/day. **Past ~50,000/day** they
  become noise; replace with per-function alarms plus an error-*rate* alarm.
- The dashboard's red line at **concurrency 10** must move when **FU-0** raises the
  quota, or it is a lie drawn on a graph.

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
| `topicName` | `biztrack-alerts` *(added by FU-EOS-6)* |
| `alarmName` ×5 | `biztrack-api-5xx`, `-lambda-errors`, `-lambda-throttles`, `-dynamodb-throttles`, `-purge-not-running` *(added by FU-EOS-6)* |
| `dashboardName` | `biztrack` *(added by FU-EOS-6)* |

Also needed: an env-suffixed stack id in `infra/bin/infra.ts` (currently the literal
`'BiztrackStack'`).

> **Why FU-EOS-6 added seven more names rather than letting CDK generate them.** The
> invoices handler set the precedent that new resources carry no physical name. The
> monitoring resources deliberately break it, because their names are the product:
> the alarm name is the subject line the owner reads at 3am, and
> `BiztrackStack-LambdaErrorsAlarm8ED74A7D` tells a chartered accountant nothing. The
> topic name is what the one-off `aws sns subscribe` command and the `verify.sh`
> lookup both key on. These are cheap to parameterize when FU-B6 lands — unlike the
> table and the user pool, an alarm is stateless, so a rename is a delete-and-create
> with nothing to lose.

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

### FU-B9 · ~~Lambda runtime `nodejs20.x` is deprecated~~ — RESOLVED 2026-07-23

**Fixed and deployed.** All 11 functions moved `nodejs20.x` → **`nodejs24.x`**; execution
environment reports `nodejs:24.v48`, and the AWS SDK's node-version warning is gone.

Runway bought, from AWS's published table (checked 2026-07-23):

| Runtime | Deprecation | Block create | **Block update** |
|---------|-------------|--------------|------------------|
| `nodejs20.x` *(was)* | 2026-04-30 | 2027-02-01 | **2027-03-03** |
| `nodejs22.x` | 2027-04-30 | 2027-06-01 | **2027-07-01** |
| `nodejs24.x` *(now)* | 2028-04-30 | 2028-06-01 | **2028-07-01** |

24 over 22 because it buys a full extra year on the date that actually bites — the one
after which no code change can be deployed to an existing function — at no cost: every
`@aws-sdk` package declares `node >=20.0.0`, `axios` declares no engine, and no transitive
dependency sets an upper bound. Both are Amazon Linux 2023.

The Docker bundling fallback image moved with it, so builds and runtime stay on one Node
major. `infra/test/infra.test.ts` now asserts *no function runs a deprecated runtime* and
*all 11 share one runtime*, rather than pinning a version string — the previous test
hardcoded `nodejs20.x` and had to be hand-edited for this bump.

**Next Node deadline: 2028-07-01.** Node.js 26 lands on Lambda around November 2026.

### FU-B10 · Remaining `infra/` advisories are dev-only  → surfaced 2026-07-23

`npm audit` in `infra/` reports 3 (1 low, 2 high) after the aws-cdk-lib bump:
`@babel/core` (arbitrary file read via sourceMappingURL), `brace-expansion` (DoS), and
`js-yaml` (quadratic CPU on merge-key chains).

All transitive under `jest` / `ts-jest`, or under `aws-cdk-lib`'s own `minimatch`. **Nothing
from `infra/node_modules` is deployed** — `infra`'s only production dependencies are
`aws-cdk-lib` and `constructs`, and what ships to AWS is the `lambda/` asset. These run at
test and synth time on a trusted machine against trusted input, so the practical risk is
low. `npm audit fix` clears them via routine jest/ts-jest patch bumps; folded into the next
dependency pass rather than done piecemeal.

### FU-B11 · No component test coverage in `src/`  → surfaced 2026-07-23

**Deliberately deferred, not an oversight.** `src/` has four test files —
`shared/utils/pricing`, `shared/utils/pagination`, `shared/utils/inventory`,
`shared/services/apiParams` — and every one tests a pure function. Zero components are
rendered anywhere in the suite.

**The bug that proves the gap.** `ProductSummaryTable` summed the `products` prop for its
TOTAL row, but the page passes that prop the paginated slice (50 of 57 from
`useInventory`'s `paginatedProducts`). The row was labelled "Total" and sat directly under
valuation cards counting all 57 — two totals on one screen, differing, with nothing saying
why.

What makes it the motivating case: **`inventoryTotals` was correct and thoroughly
unit-tested the whole time.** `inventory.test.ts` covers it, including the round-VP-once
rule and zero-quantity products. The defect was entirely in *which array the component
handed it* — wiring, not logic. No test over pure functions can observe that, no matter how
complete. A render test asserting "the TOTAL row equals the cards when the catalogue spans
more than one page" catches it on the first run.

**What it would take:**
- `vite.config.ts` → `test.environment: 'node'` becomes `'jsdom'`. The `include` glob
  already lists `src/**/*.test.tsx`, so the file pattern needs no change — the environment
  is the only blocker.
- Add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` as devDependencies.
- Note the environment switch is global. Existing pure-logic tests would start running
  under jsdom (slower, and they gain a DOM they do not want); a per-file
  `// @vitest-environment jsdom` docblock on component tests only is the narrower option
  and keeps the existing four untouched.

**Trigger — revisit when a second bug of this shape appears.** One prop-wiring defect is a
fix; two is a pattern, and at that point the toolchain pays for itself. Until then the cost
(new dependency surface, a second test idiom to maintain, slower suite) outruns the
evidence. Do not add it speculatively.

**First tests to write when the trigger fires**, highest value first: the
`ProductSummaryTable` totals-vs-page-slice case above; `BatchTable`'s write-off affordance
(labelled on expired-with-stock rows, disabled at `quantity <= 0`); and the
`InventoryValueCards` / TOTAL row agreement that ties the two together.

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

### FU-B7 · ~~`axios` / `form-data` advisories in `lambda/`~~ — RESOLVED 2026-07-23

**Fixed and deployed.** `axios` 1.16.0 → 1.18.1 and `form-data` 4.0.5 → 4.0.6;
`npm audit --omit=dev` now reports **0**. `form-data` needed a second step — axios 1.18.1
declares `^4.0.5` and the lockfile had pinned exactly 4.0.5, still inside the vulnerable
range, so `npm update form-data` moved it within axios's own range (no override needed).
Verified by downloading the deployed artifact and reading both versions out of the live
zip. Original write-up kept below for context.

---

`npm audit --omit=dev` in `lambda/` reported **2 high** advisories in **production** dependencies:

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

- **~~Tasks status/priority filter `:prefix` ValidationException~~** — RESOLVED 2026-08-05.
  `listTasks` seeded an unused `:prefix`, so `GET /tasks?status=…` and `?priority=…` 500'd on
  every filter selection. `filterParts` is now seeded with `begins_with(SK, :prefix)`: the
  binding is referenced on every path, and filtered queries keep the SK scoping they were
  silently dropping. Covered by `lambda/src/tasks.test.ts`. **Fixed and deployed
  2026-08-05 07:50 UTC** — the 500 is resolved in production.
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
