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
