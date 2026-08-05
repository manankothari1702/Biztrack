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
