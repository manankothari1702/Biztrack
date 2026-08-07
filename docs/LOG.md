# LOG — `biztrack`

Append only. Newest at the bottom. **One entry per completed feature** — not per
edit, not per day. Never rewrite a prior entry; if something turned out wrong, write
a new entry saying so.

This is the only document a code change is required to update. That is deliberate —
one document that is always current beats three that are usually not.

History before 2026-08-05 is in the git log and in `docs/followups/README.md`; it was
not back-filled here, because inventing entries for work nobody remembers in detail
would produce a document that reads authoritative and is not.

---

## [2026-08-05] — Adopted AI-EOS (categories 1–3)

**Status:** Completed — deliberately stopped after category 3, which `MIGRATION.md`
says is where most existing apps should stop.

**What changed and why**

Before: the project had no company standard vendored, no `AGENTS.md`, no release
gate, no health endpoint, no security headers, and documentation that described a
Firebase backend the app stopped using some time ago. After: the standard is
vendored at `.ai-eos/`, three project documents exist, `./verify.sh` answers "can
this deploy?", the API has an unauthenticated `/health` probe, and CloudFront sets
security headers.

**Nothing that was working was changed.** No API path, response shape, environment
variable, container, volume or folder was touched. Every change is additive or
documentation. The app's architecture — React/Vite on S3+CloudFront, API Gateway,
Lambda, DynamoDB, Cognito, CDK — was explicitly kept, against a standard that
assumes Docker, PostgreSQL and FastAPI. Adopting that stack would be a rebuild, not
an adoption.

**Files touched**
- `.ai-eos/` — the standard, vendored (renamed from `AI-Engineering-Operating-System/`)
- `AGENTS.md` — new, at root, imports the standard so every AI tool auto-loads it
- `CLAUDE.md` — reduced to `@AGENTS.md`; its AWS guidance moved to `docs/RULES.md`
  as BR-BIZ-E01..E04, with the secret-safety rule kept in `AGENTS.md` as law
- `GEMINI.md` — new, one line
- `docs/PROJECT.md` — new. §8 records all eight deliberate deviations
- `docs/RULES.md` — new. Five business rules read out of the code
- `docs/LOG.md` — new (this file)
- `verify.sh` — new, adapted to this stack rather than copied
- `.githooks/pre-commit` — new, **not enabled** (see below)
- `.gitignore` — ignores cdk.out, lint artefacts, the leftover Firebase cache
- `README.md`, `APPLICATION_OVERVIEW.md` — corrected the Firebase claims
- `lambda/src/health.ts`, `health.test.ts` — new health endpoint + 8 tests
- `lambda/src/lib/log.ts` — new structured logger, added alongside existing logging
- `infra/lib/biztrack-stack.ts` — health Lambda, `/health` route, CloudFront
  response headers policy, `HealthUrl` output
- `infra/test/infra.test.ts` — 8 new tests; two count assertions 12 → 13

**Edge cases handled** — `/health` is the only unauthenticated method in the API,
and a test asserts it stays the only one, guarding the inverse risk of a future
route shipping without the Cognito authorizer. Health detail is gated behind
`HEALTH_TOKEN`, which defaults to empty, so the rich body cannot leak by
misconfiguration. The probe never reads a business table.

**Explicitly NOT handled:** soft delete (FU-EOS-1), a Content-Security-Policy
(FU-EOS-3), and the four-role model, which this app deliberately does not have
because it has one user per account (PROJECT.md §8 D-02).

**Assumptions / open ambiguities**
- `docs/RULES.md` marks three items 🔴 `[OWNER TO CONFIRM]` rather than guessing:
  which Herbalife price-list version the tiers come from, Herbalife's own VP
  rounding method, and — the important one — **whether Indian invoice numbering
  requires a financial-year reset**. The app currently resets on the calendar year.
  Do not code an FY reset until that is confirmed.
- The health endpoint reports `backup: "pitr-continuous"` and omits `restarts` and
  `last_backup_at` rather than reporting `0` and a fabricated timestamp.

**What could break later**
- `/health` and the security headers went live with the deploy of 2026-08-05 06:31 UTC.
  Until then `verify.sh` reported the health check as failing against the deployed
  stack — correctly.
- HSTS is now sent with a one-year max-age. It is honoured by browsers for a year
  and cannot be recalled quickly; `preload` was left off for that reason.
- `infra/test/infra.test.ts` counts Lambda functions. Adding a function fails those
  two assertions on purpose — update the count, do not delete the test.

**Checks**
- [x] Tests no worse than the Phase 0 baseline — root 113 pass (unchanged), lambda
      247 → 255 pass, infra 33 → 41 pass. No test was weakened or skipped.
- [x] `npm run build` passes; `cdk synth` succeeds
- [x] `npm run lint` still exactly 15 errors + 4 warnings — the same red it was
      before adoption started. Tracked as FU-EOS-4, not fixed here, because
      "adoption left lint no worse" is only provable if adoption did not touch it.
- [ ] `./verify.sh` green — **RED, expected.** It fails on the pre-existing lint
      errors and on the not-yet-deployed health check. `MIGRATION.md`: treat its
      failures as a to-do list, not a blocker.
- [x] `docs/PROJECT.md` updated — §8 carries every deviation
- [x] `docs/RULES.md` updated — five business rules recorded

**Rollback:** `git reset --hard pre-ai-eos-baseline`, or drop the branch, then
`cd infra && npx cdk deploy`. It went live 2026-08-05 06:31 UTC, so a git-only
rollback does not change AWS.

---

## [2026-08-05] — Fixed the tasks `:prefix` ValidationException (`GET /tasks` filters)

**Status:** Completed in source. **Deployed 2026-08-05 07:50 UTC** — the 500 is
resolved in production.

**What changed and why**

`GET /tasks?status=…` and `?priority=…` returned 500 for every filter selection, and
had done since the handler was written (`6fe911b`, 2026-05-06). `listTasks` seeded
`ExpressionAttributeValues` with `:prefix` but referenced it only in the no-filter arm
of a ternary, so any filtered request left the binding unused — which DynamoDB rejects
with `ValidationException`. There is no local catch, so it surfaced as a generic 500
rather than anything diagnosable. The Tasks page sends `status` and `priority` whenever
either dropdown leaves "All", so every filter in the UI hit it.

`filterParts` is now seeded with `begins_with(SK, :prefix)` rather than using it as the
no-filter alternative. The binding is referenced on every path and the ternary collapses.
This also restores SK scoping that filtered queries were silently dropping: GSI2 is
`(PK, dueDate)` projecting ALL, and only the absence of a `dueDate` attribute on other
entities was keeping non-task rows out. `listTasks` now matches `listTasksByDateRange`
in the same file and the GSI2 reads in `dashboard.ts` — one shape for GSI2, not two.

**Files touched**
- `lambda/src/tasks.ts` — 2 logic lines, plus a comment that described the bug as still open
- `lambda/src/tasks.test.ts` — new, 3 tests
- `lambda/vitest.config.ts` — comment only
- `docs/followups/README.md` — closed the pre-existing-bugs entry

**Edge cases handled** — the unfiltered path is byte-identical: the joined expression is
the same literal string the `else` arm produced, asserted by test rather than assumed.

**Explicitly NOT handled** — `FilterExpression` applies after `Limit`, so a filtered page
can return fewer than `pageSize` items alongside a non-null `nextToken`. That is
pre-existing DynamoDB semantics, unchanged here, and merely observable for the first time
now that the path returns 200. Also not done: extracting a pure query builder, which is
the better long-term shape and the one this suite prefers, but is a refactor this fix did
not require.

**Assumptions / open ambiguities** — none.

**What could break later**

`tasks.test.ts` is the first test in `lambda/` to mock the DynamoDB client. The mock does
not emulate `ValidationException`, so its `statusCode` assertions are smoke only — the
assertion of record is the shape of the built expression. `lambda/vitest.config.ts` now
records when handler mocking is acceptable; pure-function tests remain the preferred shape.
If that exception starts being used more widely, revisit the pure-builder option above.

**Checks**
- [x] Tests no worse than before — lambda 255 → 258 pass, root 113 unchanged, infra 41
      unchanged. No test was weakened or skipped.
- [x] Tests verified to FAIL on the pre-fix code, then pass after
- [x] `npm run build` (tsc) clean
- [x] `npm run lint` still exactly 15 errors + 4 warnings — the FU-EOS-4 baseline, untouched
- [ ] `./verify.sh` green — still RED for the pre-existing reasons (FU-EOS-4 lint, the
      not-yet-deployed `/health`). Unchanged by this work.

**Rollback:** revert this commit, then `cd lambda && npm run build` and
`cd ../infra && npx cdk deploy` — it went live 2026-08-05 07:50 UTC, so a revert
alone does not change production.

---

## [2026-08-05] — Fixed the tasks `Overdue` ValidationException (`GET /tasks?status=Overdue`)

**Status:** Completed in source. **Deployed 2026-08-05 08:30 UTC** — verified in
production: `GET /tasks?status=Overdue` returns 200 and the `ValidationException`
is gone from `/aws/lambda/biztrack-tasks`.

**What changed and why**

`GET /tasks?status=Overdue` still returned 500 after the `:prefix` fix above, while
`status=Pending`, `priority=High` and the two combined recovered to 200. This is a
second, independent defect on the same code path, not a regression from that fix:
`dueDate < :now` has sat in the `FilterExpression` since the handler was written
(`6fe911b`), and `git show 6e0034d -- lambda/src/tasks.ts` confirms the `:prefix`
commit touched only the `filterParts` seeding. Overdue carried two validation errors
stacked; removing the first made the second observable for the first time.

`GSI2-TaskStatus` is `(PK, dueDate)`, so `dueDate` is a key attribute of the index
being queried, and DynamoDB rejects a key attribute in a `FilterExpression`:

    ValidationException: Filter Expression can only contain non-primary key
    attributes: Primary key attribute: dueDate

The bound is now applied in the `KeyConditionExpression` instead, which is where a
sort-key predicate is legal — the same placement `listTasksByDateRange` already uses
twenty lines below. The predicate was **moved, not deleted**: `:now` stays bound and
is now referenced by the key condition, so this cannot reintroduce the orphaned-binding
500 the previous entry fixed. `#status <> :completed` stays in the filter, where it
belongs. As a side effect the read is now bounded by the index rather than paying for
rows the filter then discards.

**Files touched**
- `lambda/src/tasks.ts` — 3 logic lines in `listTasks`, plus a comment
- `lambda/src/tasks.test.ts` — 6 new tests, no existing line modified

**Edge cases handled** — the four working paths are unchanged *by construction*: the
assignment sits inside `if (status === 'Overdue')`, so Pending, High and Pending+High
emit a byte-identical query. Asserted by a parameterised test rather than assumed.
Tasks with no `dueDate` are absent from the sparse GSI2 before and after, so no task
appears or disappears. Pagination improves rather than changes: `Limit` previously
counted rows read before filtering, so Overdue pages arrived under-filled.

**Explicitly NOT handled**
- `:now` is a full timestamp while `dueDate` is stored as UTC midnight
  (`dateUtils.ts` `fromInputDate`), so a task due *today* reads as overdue from
  05:30 IST. `useTasks.ts:70` applies the same comparison client-side but
  `TaskItem.tsx:93` uses a stricter "past AND not today" rule for the badge. The three
  disagree. This fix preserves the server's existing semantics exactly rather than
  changing behaviour inside a 500 fix. **[OWNER TO CONFIRM]** what "overdue" means.
- The Overdue+High sort at `tasks.ts:96-99` sorts only the current page. Pre-existing.
- The comment at `tasks.ts:43-46` was left as-is: re-read line by line, every claim in
  it is still true, and this fix removed the divergence it under-described.

**Assumptions / open ambiguities** — none, beyond the `[OWNER TO CONFIRM]` above.

**What could break later**

The unit tests assert the expression this handler builds, using the same mock that
missed both defects — the mock does not emulate `ValidationException`, so a green suite
is not evidence that DynamoDB accepts the query. The assertion of record is therefore
the CLI reproduction below, not the tests. Note also there is **no development
environment**: `list-tables` returns only `biztrack`. Every verification call was
read-only for that reason, and anything stronger than a shape assertion has to be run
against production with the same care.

**Checks**
- [x] Reproduced against the real table: the old shape returns the exact CloudWatch
      `ValidationException`; the new shape, and the new shape plus `priority`, are both
      accepted. One `--select COUNT` on a real partition returned a genuine overdue task.
      All calls read-only — `DescribeTable`, and `Query` (no writes, no deploy).
- [x] Live `DescribeTable` confirms GSI2 range key is `dueDate`, matching `infra.test.ts:80`
- [x] Tests verified to FAIL on the pre-fix code, then pass after
- [x] Tests no worse than before — lambda 258 → 264 pass, root 113 unchanged, infra 41
      unchanged. No test was weakened or skipped.
- [x] `npm run build` (tsc) clean, frontend and lambda
- [x] `npm run lint` still exactly 15 errors + 4 warnings — the FU-EOS-4 baseline, untouched.
      None of the 15 are in either file touched here.
- [ ] `./verify.sh` green — still RED, for the pre-existing reasons only. Unchanged by
      this work. Two failures, neither caused here:
      1. the FU-EOS-4 lint baseline, untouched;
      2. `health: healthy` is **intermittent**. It reported `degraded` on two of three
         runs this session and passed on the third. `degraded` means the `DescribeTable`
         probe exceeded `SLOW_MS` (500ms) in `health.ts:37` — a cold Lambda container
         exceeds it on the first request even though warm round trips are ~200-280ms.
         So the release gate is flaky by construction: whether it goes green depends on
         whether it happens to hit a warm container. Not investigated further and not
         filed — out of scope for this fix, but it should be, because a gate that fails
         at random trains people to ignore it. Worth a follow-up.

**Rollback:** revert this commit, then `cd lambda && npm run build` and
`cd ../infra && npx cdk deploy` — it went live 2026-08-05 08:30 UTC, so a revert
alone does not change production.

---

## [2026-08-05] — WhatsApp credentials moved to Secrets Manager (`7e7a934`), deployed

**Status:** **Deployed 2026-08-05 12:21 UTC.** CloudFormation `UPDATE_COMPLETE`,
deployment time 57.87s, no rollback and no failed resources. Verified in production.

**What changed and why**

`biztrack-whatsapp-scheduler` had failed 100% of invocations for at least 31 days:
4,320 errors/day (1,440 EventBridge runs x 3 async retries), every day of the 30-day
CloudWatch retention window. Nothing alerted, because the account has no alarms at all
(FU-EOS-6). It was not a broken feature. WhatsApp is intentionally unavailable — the
Meta Business API credentials have not been purchased — and `GetParameterCommand`
throws `ParameterNotFound` rather than returning empty, so the `?? ''` fallback on the
next line was unreachable dead code.

Both consumers now read `biztrack/whatsapp/token` and `biztrack/whatsapp/phone-id`
from Secrets Manager, per the decision to standardise on it for secrets. Each swallows
exactly one error, `ResourceNotFoundException`; everything else rethrows.

**Deployed resources** — 14, all modify, no creates, deletes or replacements:
- 1 `AWS::IAM::Policy` — `ssm:GetParameter`/`GetParameters` on `parameter/biztrack/*`
  replaced by `secretsmanager:GetSecretValue` on `secret:biztrack/*`
- 13 `AWS::Lambda::Function` — shared asset, code hash `I3okSeBm…` to
  `VbLLByGTQOE7/2bsR0KFnja6a91ZTriUTVOVuZr09sg=`, all `Active`/`Successful`

**Production results — before vs after** (`biztrack-whatsapp-scheduler`)

| Metric | Before (24h to 12:12 UTC) | After (11.1 min from 12:23 UTC) |
|---|---|---|
| Errors | 4,320 (100% failure) | **0** |
| Invocations | 4,320 (~3/min) | 12 (~1.08/min) |
| Throttles | 0 | 0 |
| Duration avg | 34.64 ms | 130.86 ms |
| ConcurrentExecutions max | 2 | 1 |

Invocations fell to roughly one per scheduled minute because the 3x async retry only
existed while invocations were failing. Duration rose because the function now
completes two Secrets Manager round trips before returning, where before it died at
the first SSM call; the sample also includes cold starts from 13 replaced containers.
That is expected, not a regression. Account-wide Lambda `Errors` since deploy: 0.

**Runtime verified in production**
- Scheduler logs contain only `START`/`END`/`REPORT`. Zero matches for `ERROR`,
  `Invoke Error`, `Exception` or `ResourceNotFound`. The silent no-op works.
- `whatsappTest` returns `400 {"error":"WhatsApp is not configured."}`.
- Live IAM on the execution role grants exactly one credential action,
  `secretsmanager:GetSecretValue` on `secret:biztrack/*`. Zero statements granting
  `ssm:` remain. Zero `AccessDenied` events in either WhatsApp log group.
- No secrets exposed: env vars are `ALLOWED_ORIGINS`, `TABLE_NAME` and
  `AWS_NODEJS_CONNECTION_REUSE_ENABLED` only; zero `Bearer` occurrences in logs; the
  400 body carries no credential material.
- Both secrets confirmed absent, so this is the unconfigured path, not activation.
- Cross-project isolation: this account also holds `jsg-directory/*` secrets for
  another app. All three evaluate `implicitDeny` under the new grant. A `secret:*`
  wildcard would have granted read access to another project's DB master password.
- No regression in the other 11 functions: `GET /tasks`, `?status=Pending` and
  `?status=Overdue` all 200; `/health` healthy when warm; auth boundaries 401; HSTS,
  `X-Content-Type-Options` and `Referrer-Policy` all present.

**Explicitly NOT verified**
- **Automatic activation when the secrets are created was not observed.** Creating a
  real secret would arm live WhatsApp messaging, which is out of scope for a deploy
  check. What is proven is the mechanism: IAM authorises the bare-name ARN, so a
  created secret resolves rather than returning `AccessDenied`.
- The post-deploy observation window is 11.1 minutes. The error result needs no
  extrapolation — the baseline failed every single invocation, so 12 consecutive
  clean runs is categorical — but the daily invocation rate should not be read
  precisely off a window this short.

**Known debt, unchanged by this deploy**
- `getSecret` is duplicated verbatim in both handlers. Extracting it would be a
  wrapper around one SDK call, which `AGENTS.md` rules out.
- `whatsappTest` reserves a rate-limit slot before discovering the feature is
  unconfigured, so a user burns one of ten daily sends for a 400.
- `AGENTS.md` forbids calling `get-secret-value` and mandates
  `{{resolve:secretsmanager:...}}` with `asm-exec`. That is a deploy-time
  CloudFormation reference: it fails the deploy when the secret is absent, so it
  cannot express "absent means off", and it would place credentials in plaintext
  Lambda env vars. `asm-exec` is a container pattern; this app is serverless
  (`PROJECT.md` §8 D-05). This needs an ADR.
- Two orphaned `/biztrack/google/*` SSM parameters remain in the account, read by
  nothing in this codebase.
- `/health` reported `degraded` on the first post-deploy request (1.66s) then healthy
  when warm. Pre-existing `SLOW_MS` cold-start threshold in `health.ts:37`, unchanged.

**Test artifact** — verifying `whatsappTest` required an invocation, and that endpoint
reserves a rate-limit slot before the config check, so a synthetic uid
(`verify-deploy-synthetic-uid`) was used rather than the owner's, leaving the real
quota untouched. It wrote one row carrying `expiresAt` 2026-08-07 12:24:07 UTC; the
table has TTL enabled on that attribute, so it deletes itself. No manual cleanup.

**Checks**
- [x] CloudFormation `UPDATE_COMPLETE`, no rollback, no failed resources
- [x] All 13 Lambdas on the new code hash, `Active`/`Successful`
- [x] Live IAM policy verified least privilege; SSM grant gone
- [x] Scheduler errors 4,320/day to 0; account-wide Lambda errors 0
- [x] `whatsappTest` returns 400; no secrets in logs, env vars or responses
- [x] 418 tests pass (lambda 264, root 113, infra 41)
- [ ] `./verify.sh` green — still RED on the FU-EOS-4 lint baseline (15 errors, 4
      warnings), none in any file in this commit. Unchanged by this work.

**Rollback:** `git revert 7e7a934`, then `cd lambda && npm run build` and
`cd ../infra && npx cdk deploy`. It is live, so a revert alone does not change
production. Code and IAM revert together in one changeset, so there is never a window
where the grant and the code disagree. Rolling back restores the SSM grant and both
SSM readers, returning the scheduler to ~4,320 errors/day — the previous status quo,
not an outage.

---

## [2026-08-05] — CloudWatch monitoring and alerting (`8a0b5d1`), deployed

**Status:** **Deployed 2026-08-05 13:23 UTC.** CloudFormation `UPDATE_COMPLETE`,
deployment time 16.59s, no rollback and no failed resources. All five alarms verified
`OK` against real production metrics. **Two owner actions remain outstanding — see
"Not done, and cannot be done by code" below. Until the first one is finished, the
alarms still deliver nothing.**

**What changed and why**

The account had **zero alarms, zero SNS topics and zero dashboards** (FU-EOS-6). That
is how `biztrack-whatsapp-scheduler` failed 4,320 times a day for at least 31 days
with nobody knowing, and how the tasks `:prefix` bug 500'd every filtered query until
a human read the code. Nothing was watching anything.

**Deployed resources** — 7, all creates, no modifies, deletes or replacements. `cdk
diff` showed **no change to any Lambda code asset**, so no running code was touched:

| Resource | Name |
|---|---|
| `AWS::SNS::Topic` | `biztrack-alerts` |
| `AWS::CloudWatch::Alarm` ×5 | `biztrack-api-5xx`, `-lambda-errors`, `-lambda-throttles`, `-dynamodb-throttles`, `-purge-not-running` |
| `AWS::CloudWatch::Dashboard` | `biztrack` |

**Zero IAM changes.** A same-account CloudWatch alarm publishing to SNS is authorised
by the default topic policy, so no topic policy and no role grant were needed. The
least-privilege work from the Secrets Manager migration is untouched.

**Two corrections to the reviewed design.** Both were caught before deploy, and in
both cases the reviewed version would have shipped an alarm that never fires:

- **`ThrottledRequests` replaced by `ReadThrottleEvents + WriteThrottleEvents`.** The
  former is published only *with* an `Operation` dimension, so a `TableName`-only
  alarm on it never leaves `INSUFFICIENT_DATA`. AWS CDK marks its own
  `metricThrottledRequests()` as *"@deprecated Do not use this function. It returns an
  invalid metric."* for exactly this reason.
- **Purge window 24h replaced by 5 x 6h.** CloudWatch aligns one-day periods to 00:00
  UTC and the job runs at 03:00, so `treatMissingData: BREACHING` on a 24h window
  would have emailed a false alarm every single morning.

**Production results**

All five alarms reached `OK`. The state reasons CloudWatch produced are themselves the
evidence that the two corrections were right:

| Alarm | State | What its own reason proves |
|---|---|---|
| `biztrack-api-5xx` | OK | no 5XX in production |
| `biztrack-lambda-errors` | OK | `1 datapoint [0.0]` - Lambda **does** publish zero-valued datapoints account-wide, so this alarm evaluates on real data, not on absence |
| `biztrack-lambda-throttles` | OK | same, `[0.0]` |
| `biztrack-dynamodb-throttles` | OK | `no datapoints ... treated as [NonBreaching]` - the metric never publishes, which is why `treatMissingData` had to be explicit |
| `biztrack-purge-not-running` | OK | `2 of the last 5 datapoints ... and 3 missing datapoints were treated as [Breaching]` |

That last row is the correction proving itself in production: **three** empty 6h
windows in healthy operation, against a threshold of **five**. A margin of two, exactly
as derived from the measured cadence of one run/day. On the reviewed 24h window this
alarm would already be firing.

**Alarm to SNS delivery verified in both directions.** From
`describe-alarm-history` on `biztrack-api-5xx`:

```
18:53:46  StateUpdate  INSUFFICIENT_DATA -> OK
18:53:46  Action       Successfully executed action arn:aws:sns:...:biztrack-alerts
18:57:08  StateUpdate  OK -> ALARM            (forced via set-alarm-state)
18:57:08  Action       Successfully executed action arn:aws:sns:...:biztrack-alerts
```

Both `addAlarmAction` and `addOkAction` fire and SNS accepts the publish. The forced
transition was reverted immediately; no real 5XX occurred.

**Dashboard verified from the deployed body**, not from the synth: 8 widgets, all 13
per-function Lambda error series resolved to real function names (including the
generated `BiztrackStack-InvoicesHandlerD5D9BEFE-...`), and the Estimated Charges
widget correctly pinned to `us-east-1` while every other widget resolved to
`ap-south-1`.

**The new `verify.sh` guard was confirmed working by failing.** Run against live AWS it
reports: *"biztrack-alerts has no CONFIRMED subscriber - every alarm fires into
nothing"*, and prints the exact `aws sns subscribe` command. This is the guard doing
its job, not a defect.

**Not done, and cannot be done by code**

1. 🔴 **The SNS email subscription is `PendingConfirmation`.** `aws sns subscribe` was
   run for the owner's address at 13:25 UTC; **the confirmation email had still not
   been delivered 10 minutes later**, checked across the whole mailbox including spam
   and trash. The mailbox demonstrably receives AWS mail (7 prior threads from
   `amazonaws.com`). Nothing in the stack is wrong — a subscription is *always* pending
   until a human clicks — but **until that link is clicked, every alarm above fires
   into nothing**, which is precisely the failure this work exists to remove. If the
   mail never arrives, delete and re-create the subscription.
2. 🟡 **Billing alerts are still off**, so the Estimated Charges widget renders empty.
   `aws cloudwatch list-metrics --namespace AWS/Billing --region us-east-1` returns
   `[]`. This is **not scriptable**: the `aws billing` API exposes only billing *views*
   and has no preference commands, and "Receive Billing Alerts" is a console-only
   setting under Billing preferences. Owner action, one checkbox.
3. 🟡 **No external uptime monitor yet** (Decision B1). Every alarm here is internal:
   they need a request to be made and to fail. A free external monitor on
   `HealthUrl` is what covers "the whole thing is down on a quiet day".

**Deliberately not built**, so it is not re-litigated: latency alarms (p99 is cold
starts, 51ms p50 against 1,699ms p99), 4XX alarms (401s from expired tokens are
normal), `log.error` metric filters, per-function alarms, a scheduler-liveness alarm
(WhatsApp is intentionally unconfigured), any cost alarm (the $25 budget already
exists and works), and CloudWatch Synthetics (~$10/mo against ~$3 of budget headroom).

**Thresholds are not permanent.** `BR-BIZ-E06` records the review trigger: past roughly
50,000 Lambda invocations/day, threshold 1 becomes noise and the replacement is
per-function alarms plus an error-*rate* alarm. The dashboard's red line at
concurrency 10 must move when **FU-0** raises the quota, or it becomes a lie.

**Cost:** ~$0.60/month at AWS list price — 4 single-metric alarms at $0.10, one
2-metric math alarm at $0.20, SNS email inside the 1,000/month free allowance, one
dashboard inside the 3-free allowance. Confirm on the first bill.

**Checks**
- [x] CloudFormation `UPDATE_COMPLETE`, no rollback, no failed resources
- [x] 7 creates, 0 modifies, 0 deletes, 0 replacements, no Lambda asset change
- [x] All 5 alarms `OK` against real production metrics
- [x] Alarm and OK actions both `Successfully executed` against the topic
- [x] Dashboard renders 8 widgets; billing widget pinned to `us-east-1`
- [x] Zero non-ASCII in the synthesized template (BR-BIZ-E04), asserted by test
- [x] 432 tests pass (lambda 264, root 113, infra 55, up from 41)
- [ ] **SNS subscription confirmed** — pending, owner must click the link
- [ ] **Billing alerts enabled** — pending, console-only owner action
- [ ] External uptime monitor configured — pending, Decision B1 owner action
- [ ] `./verify.sh` green — RED on the FU-EOS-4 lint baseline (15 errors, 4 warnings,
      unchanged, none in any file in this commit) and RED on the new
      `alarms reach a human` check until the subscription is confirmed

**Rollback:** `git revert 8a0b5d1`, then `cd infra && npx cdk deploy`. It is live, so a
revert alone changes nothing. Rolling back deletes five alarms, one topic and one
dashboard and returns the account to having no monitoring at all — the previous status
quo, not an outage. Nothing else depends on these resources.

---

## [2026-08-05] — `/health` accepts HEAD, not just GET (`c82f7a2`), deployed

**Status:** **Deployed 2026-08-05 14:21 UTC.** CloudFormation `UPDATE_COMPLETE`,
deployment time 21.75s, no rollback and no failed resources. Verified in production.

**The symptom.** The uptime monitor configured the same day (FU-EOS-6, Decision B1)
reported the app DOWN. `HEAD /health` returned **403**; `GET /health` returned 200.

**The cause was routing, not authorization.** API Gateway routes on the exact
`(resource, httpMethod)` pair and does **not** synthesize HEAD from GET the way nginx,
Apache and Express do. `/health` declared only `GET`, so a HEAD request matched no
method and was rejected *before* routing — before the authorizer, before the
integration, before Lambda ever ran.

`MissingAuthenticationTokenException` is a badly named error that means **"no such
route"**, not "no credentials". Two controls proved it:

```
HEAD /health              -> 403  MissingAuthenticationTokenException
HEAD /nonexistent-route   -> 403  MissingAuthenticationTokenException   <- identical
GET  /clients (no token)  -> 401  UnauthorizedException                 <- real auth failure
```

**Ruled out against live infrastructure before changing anything:** no WAF exists in
either the `REGIONAL` or `CLOUDFRONT` scope; the API has no resource policy
(`policy: null`); the app's CloudFront distribution has zero additional cache
behaviours and its default origin is the S3 bucket, so it never sees `/health`; and
`health.ts` references no `httpMethod`, `resource` or `requestContext` at all. The
CloudFront headers on the 403 come from the AWS-managed edge in front of the
`EDGE`-type API, which *forwarded* an origin error rather than raising one.

**Why HEAD was added rather than reconfiguring the monitor.** Both fixes cost the same
— nothing. HEAD would still invoke the Lambda and still run `DescribeTable`, so there
is no compute saving; the only difference on the wire is 20 bytes of body. The
decision was made on standards-compliance grounds: a health endpoint should answer the
verb that monitors, load balancers and reverse proxies use, and supporting it once
beats configuring every future tool around the gap. HEAD adds no exposure, because the
handler never inspects the verb.

**Deployed resources** — 5 changes, no deletions of anything real:

| Change | Resource | Note |
|---|---|---|
| create | `ApiGateway::Method` HEAD /health | the fix |
| create | `Lambda::Permission` | `execute-api:.../prod/HEAD/health` |
| create | `Lambda::Permission` | `.../test-invoke-stage/HEAD/health` (console Test button) |
| create + delete | `ApiGateway::Deployment` | deployments are immutable snapshots; CDK mints a new one on any API change and discards the old. **Not** a route deletion |
| modify | `ApiGateway::Stage` `prod` | `DeploymentId` repointed — this is how the route goes live |

**IAM: exactly two new statements**, both `lambda:InvokeFunction` on the health
function only, each `ArnLike`-constrained to its own path. One `LambdaIntegration`
instance serves both methods, and this was checked rather than assumed: CDK still
emits a **separate permission per verb**. A single shared grant was the real risk of
reusing the object, and it did not happen.

**Production verification**

| Check | Result |
|---|---|
| `HEAD /health` | **200**, **0 bytes** of body, three consecutive runs |
| `GET /health` | **200**, 20 bytes, `{"status":"healthy"}` |
| HEAD vs GET headers | **Identical**, except API Gateway adds `x-amzn-Remapped-Content-Length: 20` to HEAD |
| `Content-Length` on HEAD | `20` with an empty body — correct HTTP semantics, not a bug |
| `HEAD /clients` | **still 403** — no other route gained HEAD |
| All 5 CloudWatch alarms | **OK**, and **zero state transitions** since the deploy |
| `verify.sh` DEPLOYED STACK | **all green**, including `health: healthy` and `alarms reach a human` |

**Header note:** "same security headers as GET" is satisfied, but that set is
`Content-Type` + `Cache-Control: no-store` only. HSTS, `X-Content-Type-Options` and
`Referrer-Policy` come from the CloudFront response headers policy on the **frontend**
distribution, which is not in the API's path — so they have never been present on
`/health`. Pre-existing, unchanged by this commit, and worth knowing before anyone
assumes the API carries them.

**Monitor recovery, measured server-side.** API Gateway `4XXError` fell to **0** in the
first complete post-deploy bucket, and `biztrack-health` invocations now show a clean
**one-per-five-minutes heartbeat** (19:55, 20:00, 20:05 IST) distinct from the bursty
manual smoke tests at 19:52-19:53. Before the fix, HEAD requests never reached the
Lambda at all. **This is inference from server-side telemetry — the monitor's own
dashboard was not accessible from here, so DOWN -> UP was not read directly.**

**Checks**
- [x] CloudFormation `UPDATE_COMPLETE`, no rollback, no failed resources
- [x] Only `/health` changed; no other route, Lambda, table or monitoring resource
- [x] `HEAD /health` 200 with an empty body; `GET` unchanged
- [x] `HEAD /clients` still 403
- [x] Two new IAM statements, both per-verb scoped, no wildcard
- [x] Authorization test **strengthened**: asserts unauthenticated methods are exactly
      GET+HEAD **and** that every one of them is on `/health`. The previous version
      checked only verbs, so an unauthenticated GET on `/clients` would have passed.
      Mutation-tested both ways
- [x] All alarms OK, no transitions caused by the deploy
- [x] 433 tests pass (lambda 264, root 113, infra 56)
- [ ] `./verify.sh` green — RED on **one** item, the FU-EOS-4 lint baseline (15 errors,
      unchanged, none in this commit). Every other check passes
- [ ] Monitor confirmed UP in its own dashboard — owner to eyeball

**Rollback:** `git revert c82f7a2`, then `cd infra && npx cdk deploy`. Removes the HEAD
method and its two permissions and redeploys the stage. The monitor would return to
reporting DOWN unless switched to GET first.

---

## [2026-08-06] — Health gate retries once on `degraded`, not deployed

**Status:** Implemented and verified locally. **Nothing was deployed and nothing in
production changed** — this entry covers `verify.sh` only, which is a build-time
script. `/health`, the Lambda, the CDK stack and every latency threshold are
untouched, deliberately.

**The symptom.** `./verify.sh` reported `health: degraded` at random while production
was fine, and **always** on the first run after a deploy. Recorded but not
investigated in the tasks-filter entry above: *"it reported degraded on two of three
runs this session"*, and again after the Secrets Manager deploy: *"degraded on the
first post-deploy request (1.66s) then healthy when warm"*. A gate that fails at
random trains people to ignore it, so it was finally measured.

**The cause is connection state, not the database.** Measured 2026-08-06 via CloudWatch
Logs Insights on `@duration` and `@initDuration`, over every health invocation since
the endpoint shipped (2026-08-05 06:32 UTC — the complete population, not a sample).
Two pulls minutes apart returned **309** and **322** rows; the extra 13 are a 10-request
diagnostic burst made during the investigation plus monitor polls, and they are
excluded from the sub-60s row below so the finding does not rest on self-generated
traffic:

| Population | n | p50 | max | over `SLOW_MS` (500ms) |
|---|---|---|---|---|
| Cold container | 68 | 906ms | 1041ms | **68 (100%)** |
| Warm, >1min since last request | 204 | 266ms | 800ms | 67 (33%) |
| Warm, <60s since last request | 41 | **66ms** | **449ms** | **0 (0%)** |

(41 excludes the diagnostic burst; including it the row is 50 samples, still 0 over
threshold. The percentages below are from the 309-row pull, taken before the burst.)

`t0` in [`health.ts:42`](../lambda/src/health.ts#L42) opens **before** the first
`ddb.send()`, so the measured window contains TLS handshake, credential and endpoint
resolution — connection setup, not `DescribeTable` latency. The distribution is
bimodal: ~66ms on a hot connection, ~906ms on a new one. `SLOW_MS = 500` sits between
the two modes, so **43% of honest samples (133/309) classified as `degraded`** while
the table was `ACTIVE` throughout. `cdk deploy` replaces every container, so the first
probe after a deploy is cold by construction and failed the gate **100%** of the time.

The six invocations measured directly after a cold one ran **44-70ms**. That is why a
single retry is sufficient and why it filters the artefact and nothing else: the
slowness is a first-request-over-a-new-connection property, and a retry is by
definition a second request. A genuinely slow database is not a first-request
property, so it is still slow two seconds later and still fails.

**What changed** — `verify.sh`, health block only:

- **One retry, only on `degraded`,** after 2s. `healthy` passes without a second
  request; `unhealthy` fails immediately and is **never** retried, because a down
  database does not recover in two seconds and pretending it might is how a gate
  starts lying. A pass that needed the retry says so in its message.
- **`curl -f` dropped.** It discards the body on any status >= 400, so a genuine 503
  `unhealthy` arrived as an empty string and was reported as "no valid response".
  Status, body and curl's exit code are now kept apart, and `healthy` / `degraded` /
  `unhealthy` / unreachable are four distinct messages instead of three.
- **`health detail auth-gated` now fails closed.** The old form was
  `grep -q '"version"' && fail || pass`; an empty body made the grep fail and fell
  through to `pass`, so any curl failure silently turned a security check into a green
  tick. Verified against the old logic: it did.

**Decided against, so it is not re-litigated** (full analysis in the review that
produced this change):

- **Changing `/health` instead.** A single instantaneous measurement cannot tell a
  transient artefact from a persistent condition; that needs more than one
  observation, and only a caller can make more than one. The endpoint also has other
  consumers — the external uptime monitor, and the fleet contract in `AGENTS.md` —
  and changing it to suit one build script is the wrong blast radius.
- **Moving `SLOW_MS` 500 -> 1000.** No longer needed once the gate retries, and ~29
  hours of data is not enough to permanently redefine a production threshold. The
  deeper point is that **one threshold cannot classify a bimodal distribution**;
  picking a different single number is a different way to be wrong. Left for an
  evidence-driven follow-up after a larger observation window.
- **Two retries.** One is simpler and bounds the residual at ~7% (rule of three on
  0 failures in 41 samples), observed 0%. Expand only if production evidence justifies it.

**Verification** — 14 scenarios against a scripted local server plus the real
production endpoint. Request counts are read server-side, so "no retry" is proven by
the server never seeing a second request, not inferred from output.

| Scenario | Requests | Result |
|---|---|---|
| `healthy` | 1 | GREEN, immediate |
| `unhealthy` (503) | **1** | RED, not retried |
| `degraded` -> `healthy` | 2 | GREEN, retry noted in the message |
| `degraded` -> `degraded` | 2 | RED |
| `degraded` -> `unhealthy` | 2 | RED |
| empty body, HTTP 200 | 1 | RED, and auth-gate **fails closed** |
| HTTP 502 / non-JSON 200 | 1 | RED, "unrecognised response" with the code |
| body leaks `version` | 1 | health passes, auth-gate RED |
| whitespace in JSON | 1 | GREEN, parses correctly |
| connection refused | 0 | RED, "unreachable (curl exit 7)", auth-gate fails closed |
| no API URL / no curl | 0 | both skip |
| **real production endpoint** | 1 | GREEN in 1s, no retry |

A healthy run costs nothing extra. Only a degraded first probe pays the 2s.

**Checks**
- [x] `verify.sh` is the only file changed besides this entry. No Lambda, no CDK, no
      AWS resource, no threshold, no deploy
- [x] `bash -n verify.sh` clean (`shellcheck` is not installed on this machine, so that
      lint was **skipped, not passed**)
- [x] 433 tests pass, unchanged: lambda 264, root 113, infra 56
- [x] `npm run lint` still exactly 15 errors + 4 warnings — the FU-EOS-4 baseline,
      untouched, none in this change
- [x] Full `./verify.sh` run end to end against real AWS: `health: healthy` and
      `health detail auth-gated` both green
- [ ] `./verify.sh` green — still RED on **one** item, the FU-EOS-4 lint baseline.
      Unchanged by this work
- [ ] Post-deploy behaviour observed in the wild — the point of the change is the run
      immediately after `cdk deploy`, and no deploy has happened since. **The first
      real proof is the next deploy.**

**Known limitation, accepted.** When the first probe is `degraded` and the retry
returns `unhealthy`, the failure message still reads "Not retried, by design". The
verdict and the reason are correct; only the aside is imprecise, in a case that
requires the database to fail between two probes 2s apart. Not worth a branch.

**Follow-up opened, deliberately not done here:** `core.autocrlf=true` with no
`.gitattributes` means a fresh clone on Windows checks `verify.sh` out with CRLF, and
`#!/usr/bin/env bash` then fails to execute. The blob in git is LF and the current
working copy is LF, so nothing is broken today. Pre-existing, repo-wide, and it makes
the release gate unrunnable on a fresh clone. A one-line `.gitattributes`
(`*.sh text eol=lf`) fixes it.

**Rollback:** revert this commit. Build-time only — there is nothing deployed to undo,
and production is byte-identical either way.

---

## [2026-08-06] — Frontend lint baseline cleared, 15 → 0 (FU-EOS-4), pre-commit hook enabled

**Status:** Implemented and verified. **Nothing was deployed and nothing in production
changed.** Eight commits, all frontend/build-time; the CDK stack, the Lambdas, the
table and every deployed artefact are untouched. `./verify.sh` is now GREEN end to
end for the first time since AI-EOS adoption.

**What this closes.** The 15 lint errors recorded at adoption (`c94fd0e`) were the
single remaining RED item in the gate, and therefore the single reason
`.githooks/pre-commit` was left disabled. Both are now resolved.

**The entry under-described its own scope.** FU-EOS-4 named 6 of the 15 errors. The
other 9, spread over 6 more files, were counted but never listed — including a CDK
error in `infra/`, which is in scope because the root `eslint.config.js` matches
`**/*.{ts,tsx}` and ignores only `dist`. Anyone planning from the entry alone would
have been out by more than half. Fixed by auditing the full output first, then
batching.

**Eight commits, smallest and safest first:**

| Batch | Commit | What | Runtime change |
|---|---|---|---|
| 1 | `4e0acb1` | 4 unused bindings + 1 unused CDK import | none |
| 2 | `a203297` | redundant regex escape, 2 needless casts | none |
| 3 | `237a99f` | `@ts-ignore` → `@ts-expect-error` ×2 | none |
| 4 | `fdb2050` | 3 `no-explicit-any` in `excelUtils.ts` | none |
| 5A | `489eec2` | `DataContext` retry recurses into itself | 2 lines |
| 5B | `ec63a22` | `getItemsForDay` memoised for the Calendar memo | 4 lines |
| 5C | `2376a07` | reschedule modal seeds its date on mount | lifecycle |
| — | `8fa5c08` | FU-EOS-9 and FU-EOS-10 filed | docs |

**Two of the fifteen were real defects.** The reschedule modal painted an empty date
input for one frame before its effect corrected it — measured, not inferred, by
rendering both versions through `react-dom/server`, which runs `useState` initialisers
but not effects, i.e. exactly the first-paint frame:

```
FIRST PAINT, before : <empty>
FIRST PAINT, after  : 2026-08-07   (tomorrow, as intended)
```

And `DataContext`'s retry called the `fetchAll` const rather than itself. Harmless at
`[]` deps, because `useCallback` keeps returning the first instance — but it becomes a
stale-closure bug the day anyone adds a dependency. The remaining thirteen were
cosmetic.

**How "no behaviour changed" was established, rather than asserted.** Every file in
batches 1–4 was transpiled before and after and the output diffed. All byte-identical
except `Login.tsx`, whose one-character regex change was proven equivalent on every
code point in U+0000–U+FFFF, then checked against Cognito's full `requireSymbols` set
and a battery of passwords (a 12-char password whose only symbol is `[` is still
accepted). The unused CDK import was proven inert the same way: `tsc` elides it, so
`infra/lib/biztrack-stack.js` — the file `cdk` executes — is byte-identical across the
change, 1,062 lines, no `cdk diff` required.

Batches 4 and 5 got behavioural harnesses instead, since their emitted code does move:

- **`excelUtils`** — an import/export round trip against the real module with the DOM
  stubbed, on a deliberately awkward fixture: junk rows above the header, mixed header
  spellings, dates as `dd/MM/yyyy` / real `Date` / Excel serial, phones with and
  without country codes, rich-text, formula and hyperlink cells, a duplicate, an
  invalid mobile, a missing name, a quoted-comma CSV, plus the oversize and
  bad-extension rejections. 9 xlsx rows, 2 csv rows, 2 rejections, 5 export rows,
  4 re-imported rows — **identical before and after**, including the Firestore
  `Timestamp` compatibility branch and the CSV-injection prefixing. Only the values
  that are nondeterministic by design were normalised: 11 generated UUIDs and 3
  `new Date()` fallbacks.
- **`DataContext`** — all five paths through `fetchAll` driven with mocked deps: happy,
  404→provision-ok, 404→provision-fail, transient-then-success, retries-exhausted.
  Identical call sequences, identical 1500ms sleeps, one `Sync Error` toast not one
  per attempt, and the initial promise still resolves only after the whole retry chain
  so the loading screen does not flash between attempts.
- **`Calendar`** — ten renders replayed through the old and new hook wiring using the
  app's real `isSameDay`. **7 memo recomputes before, 7 after**, identical cell
  contents at every step. The three renders where both correctly *skip* the work
  (opening the month selector, selecting a day, an unrelated re-render) are the
  important ones: a carelessly widened dep array would have silently degraded the memo
  into recomputing every render, and the calendar would still have looked right.

**The pre-commit hook is enabled and was proven to block.** A file with a single
`no-explicit-any` — valid TypeScript, so only lint could object — was staged and
committed:

```
X  lint (frontend)
   npm run lint failed - the baseline is zero errors, so this is a new regression.
/  types (frontend)          <- confirms lint alone objected
verify --fast: RED
git commit exit code: 1
```

`HEAD` was unchanged and the commit exists nowhere in the repo. The temporary file was
then removed and the gate returned to GREEN. **`core.hooksPath` is local config and
cannot be committed, so every clone must run `git config core.hooksPath .githooks`
once** — recorded in `.githooks/pre-commit` itself.

**`verify.sh`'s lint failure message was rewritten.** It still said "15 errors were
already present at AI-EOS adoption; this is a to-do list, not a new regression" — which
became false the moment the count hit zero, and would have taught the next person to
ignore a genuine regression. It now says the baseline is zero and any error is new.

**Verification**

- [x] `npm run lint` — **0 errors**, 3 warnings (all deliberate, FU-EOS-10)
- [x] `npx tsc -b --noEmit` clean
- [x] 433 tests pass, unchanged: lambda 264, root 113, infra 56
- [x] `npm run build` and the lambda build both succeed
- [x] Full `./verify.sh` GREEN end to end, including the live AWS checks:
      `health: healthy`, `health detail auth-gated`, security headers, PITR enabled,
      `alarms reach a human`
- [x] Pre-commit hook blocks a bad commit (exit 1, `HEAD` unmoved) and permits a clean
      one — this entry's own commit went through it
- [x] No tracked file contains CRLF, checked after every commit — the FU-EOS-8
      invariant survived all eight

**Not verified, and worth being straight about.** No browser session was run at any
point. `src/` renders no components in its test suite (FU-B11), and reaching the
Calendar or the data provider means authenticating against the production Cognito pool
because there is no dev stack (FU-B6). Batches 5A–5C are therefore backed by
hook-level and first-paint evidence, not by a live click-through. The three riskiest
changes are each a separate commit for exactly that reason: `489eec2`, `ec63a22` and
`2376a07` revert independently. **A single live pass over the calendar reschedule
flow, the client import and a fresh sign-in would close the gap cheaply** and is the
recommended next action for the owner.

**Left open on purpose:** **FU-EOS-9** (four `set-state-in-effect` suppressions — the
codebase now handles one rule two ways, which is worse than either policy applied
consistently) and **FU-EOS-10** (three `exhaustive-deps` warnings, one of which,
`PhoneNumberInput`, is the only finding in the whole baseline with a plausible
user-visible bug). Both are P3 and cross-linked, since they meet in the same component.

**Rollback:** revert any batch independently; they do not depend on each other. To
disable the hook: `git config --unset core.hooksPath`.

---

## [2026-08-06] — Lambda concurrency: quota 10 → 1000, reserved concurrency enabled (FU-0) (`f07d204`), deployed

**The whole app shared ten concurrency slots.** Account `346299179287` / ap-south-1 sat
at `ConcurrentExecutions = 10` — the AWS new-account floor — and all fourteen functions
drew from it. One bulk import next to the per-minute scheduler could starve signup, the
dashboard and the health probe simultaneously, with no attacker and no bug.

**The reason it stayed that way for a month: nobody had asked.**
`list-requested-service-quota-change-history-by-quota` returned an **empty list** on
2026-08-06 — the increase was not pending, not denied, never filed. FU-0 had been
carried as P0 since July on the understanding that the fix was known and the only
missing step was AWS's review queue. The request itself was the missing step. Filed
2026-08-06 17:10 IST, case closed the same day, `ConcurrentExecutions` now **1000**.

**Confirm the applied limit, never the approval mail.** The Service Quotas case can
close before Lambda sees the new value, and `cdk deploy` validates against what Lambda
reports. `aws lambda get-account-settings` is the gate; it now reads 1000/1000.

**What shipped in the stack.** Twelve functions carry a reservation — **267 reserved,
733 unreserved** against an AWS floor of 100. A reservation is both a floor and a
ceiling: it guarantees the function its capacity and caps its blast radius at the same
number, which is what stops one bulk import draining the pool.

Sizing is `reservation >= throttle_rate x (p95_duration + cold_start)`. Cold start is
~370ms and is **excluded from the `Duration` metric while still holding the slot**, so
it has to be added by hand. Measured 30-day peaks were 1–4 per function, so every value
carries 10–30x headroom.

**Two numbers in the approved plan were wrong, and were corrected on evidence:**

- **`whatsapp-scheduler` 2 → 5.** The original rationale — "one invocation/minute, 2
  covers run-overlap" — counted the EventBridge tick but not Lambda's async retry
  policy. A failing async invocation is retried twice, so one tick occupies **three**
  slots. Not theorised: during the 2026-08-05 outage this function ran at 180
  invocations/hour against a rule firing 60/hour, peaking at **3** concurrent. At a
  reservation of 2 the third retry would hit its own ceiling — and throttled async
  invokes are themselves retried, stacking a second amplification loop on top of the
  one the original number missed.
- **`health` unreserved → 5.** The old comment read "intentionally UNRESERVED: it must
  answer even when the app is being throttled." That is the right goal reached by
  exactly the wrong mechanism. Unreserved means *no floor* — under exhaustion the probe
  is throttled alongside everything it exists to report on, and monitoring goes blind at
  the one moment it matters. A reservation is the only construct that guarantees
  capacity. 5 is not sized to load (measured demand is 0.015 concurrent); it is sized to
  stay answerable during an incident with room for a second monitor and a manual curl.

**`biztrack-post-confirmation` is deliberately the only function left unreserved.** It
is the signup critical path and rare, and now that every heavy function is capped,
nothing can drain the pool beneath it. That reasoning was previously written in the
present tense while the flag was off, when it was not yet true.

**API Gateway throttles returned to their designed width, last.** Stage 25/50 → 100/200,
`/dashboard` 5/10 → 20/40, bulk paths 2/5 → 5/10. Ordering was not stylistic: raising
the front door before the reservations existed would have removed the only thing
protecting the shared pool.

**25/50 was also the binding ceiling on the whole app, and not where anyone would look
for it.** At two polled requests per session per 30s, 25 req/s is reached at roughly
**375 concurrently open sessions with nobody clicking anything**. Lambda concurrency, at
mean duration, would have supported several thousand. 100/200 moves that to ~1,500.

**Bulk paths went to 5/10, not the 10/20 the in-code comment projected.** Each import
holds its slot for the full 20s wall-clock guard, so the *rate* term is what bites: 10
req/s sustained demands 200 concurrent against a `clients` reservation of 50. The burst
term is the realistic shape for a human-driven import and fits easily. **Do not raise
these without re-sizing `clients` and `products` first** — the two are coupled.

**The throttle alarm's meaning changed without the alarm changing.** Before, every
function shared one pool, so any throttle meant "the account is exhausted". Now a
throttle means one of two different things, and `biztrack-lambda-throttles` is
undimensioned so it fires identically for both. Its description now carries the split —
a throttle on one function means that function hit its *own* reservation (raise it); a
throttle with no single function responsible means the unreserved pool is exhausted,
which hits signup first. The description is the runbook somebody reads at 3am.

**Verification**

- [x] `npx tsc --noEmit` clean (infra)
- [x] `cdk synth -c reserveConcurrency=true` succeeds
- [x] 56 infra tests pass
- [x] Synthesized template: 267 reserved / 733 unreserved / 633 above the AWS floor
- [x] `health` = 5, `scheduler` = 5, `post-confirmation` unreserved — all as approved
- [x] Throttles in template: stage 100/200, dashboard 20/40, four bulk paths 5/10
- [x] `cdk diff`: 15 resources, **all in-place `[~]`, zero replacements, zero IAM
      changes**, zero deletions
- [x] Rollback path (`cdk synth` without the flag) emits **0** reservations

**Deployed 2026-08-06 18:18 UTC (23:48 IST), `UPDATE_COMPLETE` in 21.9s.** Eighteen
CloudFormation events, no failures, no rollback, no resource replaced.

Verified live, against AWS rather than the template:

- [x] Twelve functions carry their intended reservation; `biztrack-post-confirmation`
      and the CDK S3 helper carry none
- [x] `health` = 5, `whatsapp-scheduler` = 5
- [x] **Reserved sums to 267**, and `get-account-settings` independently reports
      **`UnreservedConcurrentExecutions: 733`** against `ConcurrentExecutions: 1000` —
      the two agree, so nothing is reserved that this stack does not know about
- [x] Stage 100/200; `/dashboard` 20/40; `/clients/bulk` POST+DELETE, `/products/bulk`
      POST and `/invoices` POST all 5/10
- [x] All five alarms `OK`
- [x] `/health` returns `{"status":"healthy"}` on **GET (200, 352ms)** and **HEAD (200,
      211ms)**
- [x] `./verify.sh` GREEN end to end, including the live deployed-stack checks
- [x] 25 minutes post-deploy: **zero throttles, zero Lambda errors** account-wide, and
      the scheduler ticking at 5 invocations per 5-minute period — exactly the 1/min the
      EventBridge rule fires, with no retry amplification

**Not verified, and worth being straight about.** The reservations have never been
exercised under real concurrency. Measured peaks are 1–4 per function against
reservations of 5–60, so the *sizing* remains untested in the only way that would
matter, which is load. Twenty-five quiet minutes proves the deploy did not break
anything; it does not prove a single number is right. The first real test is production
traffic, and the signal to watch is per-function `Throttles` — under reserved
concurrency a throttle now means "this function's own reservation is too low", which is
a different fault from the account exhaustion this work removed.

**Rollback.** `git revert` this commit and redeploy — that is the correct procedure, and
it is not the same as dropping the feature flag. **Deploying with the flag off removes
the reservations but leaves the throttles at 100/200**, because the throttle values are
not flag-gated. That combination is strictly worse than either the old or the new state:
no per-function caps *and* a front door four times wider than the one that was
compensating for their absence. The flag alone is not a rollback.

---

## [2026-08-07] — Environment reset: Firebase torn down, all data wiped, dev split from prod

**Why.** The owner wanted a genuinely fresh start: no demo data anywhere, a small empty
dev environment for testing, and Firebase gone for good. The audit that opened this work
found something nobody was looking for, so the shape of the job changed.

### The finding that mattered

**The pre-AWS Firebase app was still live and publicly serving.**
`https://biztrack-5bf99.web.app` returned HTTP 200. The bundle it served was the
*original Firebase build* — it contained the Firebase web API key, `biztrack-5bf99`,
`firebaseapp.com`, `firestore.googleapis.com` and four `identitytoolkit` references, and
**zero** references to `execute-api`, `cognito-idp` or `amazonaws`. It had no knowledge
of AWS at all.

That is not a stale link. It was a second, fully working front door into a live Firestore
database, with its own auth, running continuously since the migration and behind
credentials nobody had rotated. Firebase Auth held **four** accounts, two of which
(`thakourabhishek@gmail.com`, `atulkothari23@gmail.com`) are not the owner's.

Nothing in the repo pointed at it. `package.json` has no Firebase dependency and no
source file imports one — the migration cleaned the *code* and left the *deployment*
running. Worth remembering: a clean grep is not evidence that a backend is gone.

### What was done

**P0 — Firebase.** `firebase hosting:disable` first, to shut the public door before
anything else; the site went to **404**. Then `firestore:delete --all-collections`
removed the `users` collection; a second run lists no collections. The Auth export was
inspected to count accounts and **deleted immediately** — it carries password hashes.

⚠ **The Firebase project shell still exists.** `firebase-tools` has no
`projects:delete`, and `gcloud` is not installed on this machine. Hosting is off,
Firestore is empty, and the app that used them is gone, so the exposure is closed — but
deleting project `biztrack-5bf99` (number 619216241031) is a console action still
outstanding. **Tracked as FU-EOS-11.**

**P0 — data.** An on-demand backup (`biztrack-pre-wipe-20260807`, 91,580 bytes, matching
the table byte-for-byte) was taken first, because PITR is enabled but §10 records that a
restore has **never been tested** — that is an unverified safety net, and this was the
one irreversible step. Then all **246** items were deleted in 10 batches; a follow-up
scan returns `Count: 0`. All **3** Cognito users were deleted. The pool itself, the
table, its six GSIs, PITR, every Lambda, the API and all buckets were left untouched.

Deleted: 59 clients, 57 products, 101 batches, 6 invoices, 12 stock movements, 2 invoice
counters, 2 org roots, 1 task, 5 profiles (2 of them orphans with no Cognito user) and
the `verify-deploy-synthetic-uid` META row, which verification regenerates.

**P1 — dev/prod split.** §6 said it plainly: *"local development runs against the
production table."* That is how demo data reached production, and wiping without fixing
it would only have reset the clock. Every resource name was hardcoded, so the stack now
takes an `envName` prop. **prod takes an empty suffix on purpose** — every production
resource keeps the name it already had, so introducing dev cannot rename or replace
anything live. `cdk diff BiztrackStack` proves it: **one line, `DeletionProtectionEnabled:
true`**, nothing else. `BiztrackStack-dev` synthesizes 28 resources all suffixed `-dev`.

**P1 — safeguards.** Production's table now has `deletionProtection` (applied live and
declared in CDK, so they agree). The dev user pool does **not** list the production
CloudFront origin in its callback URLs — a dev token must not be redirectable to the
production frontend.

### A latent bug found on the way, and fixed

The first `cdk diff` showed something that had nothing to do with this work: deploying
would have **stripped `ReservedConcurrentExecutions` from all twelve functions**, silently
undoing FU-0 from the day before. The reservations were gated behind
`-c reserveConcurrency=true`, a flag that lived only in the operator's shell history —
so **any** future `cdk deploy` would have reverted them.

The flag now lives in `cdk.json` context, on by default. It is additionally gated on
`isProd`: reservations come out of the account-wide pool, so a dev stack claiming 267
would take them from the same 1,000 production draws on — dev could have throttled prod.
That is precisely the interference this split exists to prevent. After the fix, prod
diffs to the single deletion-protection line and dev synthesizes **zero** reservations.

**Note for FU-0's rollback paragraph above:** it says the flag alone is not a rollback.
That is still true, and the flag is no longer something you can forget — but it now also
means a `cdk.json` edit changes production concurrency. Treat that line as load-bearing.

**P3 — repo.** Removed the tracked `.firebase/hosting.ZGlzdA.cache`, `firestore-debug.log`
(77 KB), the three Firebase entries in `.claude/settings.local.json`, the dead
`firebase.ts` entry in `verify_dates.ts`, and the Firestore `Timestamp` shim in
`excelUtils.ts` — a wipe of every pre-AWS record makes that branch unreachable, which
retires its "Do not remove" comment. Deleted `codebase_review.md`, a review of the
Firebase codebase that described the app as "React 19, **Firebase**, Tailwind" and was
actively misleading; it is recoverable with `git show HEAD:codebase_review.md`.
`product_requirements_document.md` was **not** rewritten — its 15 Firestore references
are inside requirement statements, and silently converting them to AWS wording would
have invented requirements. It carries a historical banner pointing at `docs/PROJECT.md`
instead. Comments in `biztrack-stack.ts` ("COGNITO — replaces Firebase Auth") and the
`LOG.md` history are accurate and were left alone.

### Verified

- [x] `https://biztrack-5bf99.web.app` → **404** (was 200)
- [x] Firestore collection list **empty** (was `users`)
- [x] `scan --select COUNT` on `biztrack` → **`Count: 0`**
- [x] `list-users` → **`[]`**; user pool `ap-south-1_2QhXH4Xjd` still present
- [x] Backup `biztrack-pre-wipe-20260807` **AVAILABLE**, 91,580 bytes
- [x] `deletionProtection` **true** on the production table
- [x] `cdk diff BiztrackStack` → one in-place change, **zero replacements**
- [x] `cdk synth BiztrackStack-dev` → exit 0, 28 `-dev` names, **0** reservations
- [x] `./verify.sh` **GREEN** end to end, including the live deployed-stack checks

### Not done, deliberately

**Neither stack was deployed.** `deletionProtection` was applied with the API directly,
so production already has it and its diff is now cosmetic. `BiztrackStack-dev` exists
only as code — it has never been deployed, so **there is no dev environment yet**, and
`.env.development.local` still points at production. Deploying it creates real resources
(a CloudFront distribution among them) and is the owner's call, not a side effect of a
cleanup. **Tracked as FU-EOS-12.**

The dev stack also carries the WhatsApp scheduler and the daily purge Lambda, which will
tick against an empty table. Harmless with no clients, but it is a real EventBridge rule
firing every minute in an environment meant to be idle — worth disabling in dev if the
noise or the invocation count ever matters.

---

## [2026-08-07] — Dev environment deployed and validated; two latent write-path bugs found

**Why.** FU-EOS-12 left the dev stack as code that had never run. Until it was deployed
and proven, "development is separated from production" was a claim, not a fact.

### Deployed

`BiztrackStack-dev`, `CREATE_COMPLETE` in **319s**, 68 resources, no failures and no
rollback. Prod was not in the deploy at all — a separate stack, deployed by name.

| | |
|---|---|
| Table | `biztrack-dev` |
| User pool | `ap-south-1_2i6e273DD` |
| API | `https://gkat4p5bje.execute-api.ap-south-1.amazonaws.com/prod` |
| CloudFront | `https://d2938bm9xnbgsq.cloudfront.net` |

Both environments finished **empty**: dev 0 items / 0 users, prod 0 items / 0 users. The
smoke-test rows and accounts were deleted after validation — they are exactly the demo
data this work exists to remove.

### The five flows, verified against dev

**12 checks, 0 failures.** Sign up (the PostConfirmation trigger created the `PROFILE`
row in `biztrack-dev`), login, create client, create task, logout, plus an
unauthenticated `GET /clients` returning **401**. Logout is asserted as the revoked
refresh token no longer minting tokens — `global-sign-out` revokes access and refresh
tokens, but an already-issued idToken stays valid until expiry, and the idToken is what
the API accepts ([`apiService.ts:33`](../src/shared/services/apiService.ts#L33)). Full
logout also depends on the client clearing its own tokens, which is UI behaviour.

The script refuses to run unless it resolves `biztrack-dev`, and aborts outright on the
production pool id or the production API id. It is a validation tool, not a fixture, and
it lives in scratch — it is not part of the repo or of `verify.sh`.

### Three real bugs, none of them caused by this work

**1. The server takes an item's primary key from the request body, unvalidated
(FU-EOS-13, P1).** `keys.client(uid, body.id)` validates `clientName` and `mobile` but
never `id`. A `POST /clients` with no `id` returned **201** and wrote
`SK = "CLIENT#undefined"`. The write is a bare `PutCommand`, so a second such request
**silently overwrites the first** — two clients collapse into one row, 201 both times,
and with no soft delete and no audit trail for client edits (§7) that loss is
unrecoverable and invisible. Not reachable through the SPA, which generates a UUID per
record; reachable by anything else holding a valid token.

**2. Records without a follow-up or due date are invisible in the default list
(FU-EOS-14, P2).** `GET /clients` defaults to `sortBy = 'nextFollowUpDate'` and queries
`GSI1-FollowUpDate`, whose sort key is that field. DynamoDB does not project an item
into an index when the item lacks the index's sort key, so a client written without a
follow-up date exists, is fetchable by id, and **does not appear in the client list**.
Fifteen seconds of retries ruled out eventual consistency. `GET /tasks` is identical via
`GSI2-TaskStatus` / `dueDate`. Latent through the UI — `ClientModal.tsx:39` defaults the
follow-up to +1 week — and live at the API boundary. The index is behaving correctly;
nothing enforces the field it depends on.

Both share one root cause worth naming: **the server trusts the client to supply fields
the read path depends on.** Neither is a dev-environment artefact; both are in
production code today.

**3. `npm run dev` could not be pointed away from production (FU-EOS-15, fixed).**
`vite.config.ts` read `VITE_API_PROXY_TARGET` from `process.env`, and **Vite never
copies `.env` files into `process.env`** — so the documented override was invisible and
only worked as a shell variable. `.env.development.local` compounded it by overriding
only `VITE_API_URL`, leaving every `VITE_COGNITO_*` value to fall through to `.env`.
Local development was authenticating against the **production user pool**. Fixed with
`loadEnv`, and the default proxy target is now the dev API: the proxy runs only under
`npm run dev`, production builds use the absolute URL from `.env` and never touch it, so
reaching production from localhost should be a deliberate override rather than an
omission.

That last one matters more than its size. The dev stack could have been deployed
perfectly and `npm run dev` would still have talked to production.

### Verified

- [x] `BiztrackStack-dev` `CREATE_COMPLETE`, 68 resources, 319s
- [x] 12/12 validation checks pass against dev
- [x] dev **0 items / 0 users**; prod **0 items / 0 users**
- [x] `./verify.sh` **GREEN**, including the production build with the new Vite config

### Not done

The five flows were exercised at the **API** level, not through the browser. They prove
the foundation — auth, the trigger, both write paths, the read paths and sign-out — but
not the UI. A browser pass against dev is worth doing before trusting the frontend
against the new pool.

FU-EOS-13 and FU-EOS-14 are **recorded, not fixed**. They are pre-existing and latent
through the UI, and fixing them is application work, not environment work.

---
