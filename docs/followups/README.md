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

### FU-0 · ~~Raise Lambda account concurrency 10 → 1000~~ — RESOLVED 2026-08-06

**Quota raised and reserved concurrency implemented.** Account `346299179287` /
ap-south-1 now reports `ConcurrentExecutions = 1000`, `UnreservedConcurrentExecutions
= 1000`, confirmed via `aws lambda get-account-settings`.

**The finding that made this take a year: the increase had never been requested.**
`list-requested-service-quota-change-history-by-quota` returned an **empty list** on
2026-08-06 — not pending, not denied, never filed. FU-0 had been carried as a P0 item
since the July remediation on the assumption that the cure was known and the only
missing step was AWS's review. The request itself was the missing step. The case was
filed 2026-08-06 17:10 IST and closed the same day.

Confirm the applied limit, not the approval mail — the Service Quotas case can close
before Lambda sees the new limit, and `cdk deploy` validates against the applied value:

```
aws lambda get-account-settings --region ap-south-1 \
  --query 'AccountLimit.{Concurrent:ConcurrentExecutions,Unreserved:UnreservedConcurrentExecutions}'
```

Twelve functions now carry a reservation (267 total, 733 unreserved against an AWS
floor of 100), and the API Gateway throttles have returned to their designed width.

**Deployed 2026-08-06 18:18 UTC (`f07d204`), `UPDATE_COMPLETE` in 21.9s.** Verified
live: reservations sum to 267 and AWS independently reports 733 unreserved; throttles
are 100/200 stage, 20/40 dashboard, 5/10 on the four heavy writes; all five alarms
`OK`; `/health` 200 on GET and HEAD; `verify.sh` GREEN; and zero throttles and zero
Lambda errors in the 25 minutes after the deploy. Full write-up, including the sizing
method and the two corrections made to the original plan, is in `docs/LOG.md`.
(From audit B4 / item 3.)

**Still open, deliberately.** The reservations are untested under load — measured peaks
are 1–4 per function against reservations of 5–60. Re-tune on trigger, not on a
calendar: any per-function `Throttles > 0`, sustained concurrency above 60% of a
reservation, or any change to the API Gateway rate limits.

---

## Owner gates — nothing in the remediation is live until these happen

1. ~~**FU-0**~~ — done 2026-08-06, see above.
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

### FU-EOS-4 · ~~`npm run lint` is red — 15 errors~~ — RESOLVED 2026-08-06

**Done. 15 errors → 0, and `./verify.sh` is GREEN end to end** — including the live
AWS checks. The pre-commit hook is enabled and was proven to block a bad commit.
Full write-up in `docs/LOG.md`.

The original entry named 6 of the 15 errors (`dateUtils.ts`, `excelUtils.ts`, the data
context). **The other 9, across 6 more files, were counted but never described** — so
anyone scoping this from the entry alone would have under-planned it by more than
half. What was actually there, and what it took:

| Batch | Commit | Findings | Nature |
|---|---|---|---|
| 1 | `4e0acb1` | 4 unused bindings (`dateUtils` ×2, `DatePicker`, and an unused CDK import in `infra/`) | dead code |
| 2 | `a203297` | `no-useless-escape` in `Login.tsx`, 2 needless casts | style / type-only |
| 3 | `237a99f` | 2 `@ts-ignore` → `@ts-expect-error` | comment only |
| 4 | `fdb2050` | 3 `no-explicit-any` in `excelUtils.ts` | type narrowing |
| 5A | `489eec2` | `react-hooks/immutability` in `DataContext` | React correctness |
| 5B | `ec63a22` | `preserve-manual-memoization` in `Calendar` (+1 warning) | React correctness |
| 5C | `2376a07` | `set-state-in-effect` in `RescheduleModal` | React correctness |

**Two findings turned out to be real defects, not lint noise.** `RescheduleModal`
painted an empty date input for one frame before an effect corrected it (5C, measured
via `react-dom/server`). And `DataContext`'s retry recursed through the callback
binding rather than itself, which is harmless at `[]` deps but becomes a stale-closure
bug the moment anyone adds one (5A). The other thirteen were genuinely cosmetic.

**Batches 1–4 changed no runtime behaviour at all** — verified by transpiling each
file before and after and diffing: byte-identical output in every case except the
`Login.tsx` regex, which was proven equivalent across the whole BMP. `excelUtils`
additionally got an import/export round trip on representative spreadsheet data.

**The hook now needs one opt-in per clone**, because `core.hooksPath` is local config
and cannot be committed:

```
git config core.hooksPath .githooks
```

On Linux and macOS it also needs the executable bit on `verify.sh`, which is still
missing — **FU-EOS-8**. Windows ignores the mode bit, so it works there today.

**Left behind on purpose:** four suppressions of `set-state-in-effect` (**FU-EOS-9**)
and three `exhaustive-deps` warnings (**FU-EOS-10**), one of which is the only finding
in the whole baseline with a plausible user-visible bug.

### FU-EOS-5 · Stale artefacts still tracked in git  → 🟢 P3
`.gitignore` now ignores them, but these were already committed and remain in the repo:
`lint_report.json` (587 KB), `lint_log.txt`, `lint_output.txt`, `output.txt`,
`repro_bug.ts` and two `.docx` interview files. Adoption did **not** delete them —
removing files is the owner's call, not a side effect of a standards pass.
`git rm --cached` whichever are genuinely dead.

**Partly done 2026-08-07:** `.firebase/hosting.ZGlzdA.cache` and
`firestore-debug.log` were removed in the Firebase teardown, along with the stale
`codebase_review.md`. The lint artefacts, `repro_bug.ts` and the `.docx` files are
untouched and still open.

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

### FU-EOS-7 · Repository URL in the docs is stale  → surfaced 2026-08-06 · 🟢 P3

**Documentation drift only. Nothing is broken.** Two files name the repository as
`github.com/mananmaheshwari1702/Biztrack`; the configured git remote is
`github.com/manankothari1702/Biztrack.git`.

Checked rather than assumed, 2026-08-06:

| URL | Result |
|---|---|
| `manankothari1702/Biztrack` (the remote) | **HTTP 200** |
| `mananmaheshwari1702/Biztrack` (the docs) | **HTTP 301** -> redirects to the above |

So this is a GitHub account rename, and the old URL still works through GitHub's
redirect. Nobody is blocked, which is exactly why it will sit there unnoticed —
GitHub redirects survive indefinitely but are not a promise, and a `git clone` of
the documented URL today succeeds, so the drift produces no error to trip over.

Two occurrences, both one-line edits:
- [`docs/PROJECT.md:31`](../PROJECT.md) — the Repository row in §2 Addresses
- [`README.md:40`](../../README.md) — inside the `git clone` command in setup

Surfaced while pushing the health-gate commit (`d587f6d`), whose push succeeded
against the real remote and so exposed the mismatch. Deliberately **not** fixed
there: correcting an unrelated document is not a side effect a health-gate commit
should carry. Verify the intended canonical URL with the owner before editing —
this records which URL git uses, not which one is meant to be permanent.

### FU-EOS-8 · No `.gitattributes`, so a fresh clone cannot run `./verify.sh`  → surfaced 2026-08-06 · 🟡 P2

**The release gate is not reliably runnable from a fresh clone.** Two independent
causes, both invisible on the machine the repo was built on.

**Cause 1 — line endings.** `core.autocrlf=true` is set and there is **no
`.gitattributes`**. Every blob in the repo is stored LF (verified repo-wide, two
methods: **zero** tracked files contain CRLF), and the current working copy is LF, so
nothing is broken *today*. But `autocrlf=true` converts LF to **CRLF on checkout**, so
a fresh clone on Windows writes `#!/usr/bin/env bash\r`, which fails to execute. The
repo is one `git clone` away from a gate that will not start, and the machine it was
authored on will never show the symptom.

**Cause 2 — the executable bit was never set.** Found while checking cause 1:

```
100644 verify.sh              <- not 100755
100644 .githooks/pre-commit   <- not 100755
```

So `./verify.sh` fails on Linux and macOS regardless of line endings. This has been
invisible because Windows ignores the mode bit, and every run in this repo's history
has effectively been `bash verify.sh`. All three documents that define "done" say
`./verify.sh`: [`AGENTS.md:26`](../../AGENTS.md), `.ai-eos/AGENTS.md:52` and
[`README.md:181`](../../README.md).

**Scope — four files, and only two carry an extension:**

| Path | Note |
|---|---|
| `verify.sh` | the gate |
| `.githooks/pre-commit` | **no extension** — a `*.sh` rule alone misses it |
| `.ai-eos/templates/new-project/verify.sh` | vendored template |
| `.ai-eos/templates/new-project/.githooks/pre-commit` | vendored template, no extension |

A root `.gitattributes` covers the two vendored paths without hand-editing `.ai-eos/`,
which `BUILD.md` forbids.

**Does the policy disturb anything else? No — and this was checked, not assumed.**
Nothing in the repo is stored with CRLF, so a narrow rule changes how **zero** other
files are stored. Resist the blanket `* text=auto eol=lf`: it is unnecessary here
(there is nothing to normalise), it puts every file at the mercy of git's binary
heuristic, and it would make a future stray CRLF commit rewrite files wholesale.
Narrow beats clever.

**Fix, roughly ten minutes:** add `.gitattributes` with an `eol=lf` rule covering
`*.sh` **and** the two extensionless hook paths; then
`git update-index --chmod=+x verify.sh .githooks/pre-commit`. **Verify by cloning into
a scratch directory and running `./verify.sh` there** — not by re-running it here,
which cannot reproduce either failure.

Surfaced by the health-gate work (`d587f6d`); `docs/LOG.md` records cause 1 only,
because cause 2 was found later, while filing this entry.

### FU-EOS-9 · Four `set-state-in-effect` suppressions left in place  → surfaced 2026-08-06 · 🟢 P3

**Nothing is broken. This is a consistency debt, filed so it is a decision rather
than an oversight.** While clearing the FU-EOS-4 lint baseline, `RescheduleModal`
was found to be the *fifth* place with a `react-hooks/set-state-in-effect`
problem. The other four already carry an `eslint-disable-next-line`:

| File | Line | What the effect does |
|---|---|---|
| [`src/shared/components/common/PhoneNumberInput.tsx`](../../src/shared/components/common/PhoneNumberInput.tsx#L46) | 46 | syncs country + number when the `value` prop changes |
| [`src/features/team/components/NodeModal.tsx`](../../src/features/team/components/NodeModal.tsx#L21) | 21 | resets the form when the modal opens |
| [`src/features/clients/components/ClientModal.tsx`](../../src/features/clients/components/ClientModal.tsx#L48) | 48 | resets the form when the modal opens |
| [`src/features/clients/components/CallOutcomeModal.tsx`](../../src/features/clients/components/CallOutcomeModal.tsx#L60) | 60, 73 | resets on open; re-defaults the date when the outcome changes |

`RescheduleModal` was fixed structurally instead (`2376a07`): the parent now
mounts it only while open, so the default comes from a `useState` initialiser
and the effect is gone. That also removed a real if minor defect — the first
painted frame had been showing the previous value for one render.

**Why the other four were not done at the same time.** The lint baseline work was
scoped to removing errors, and these four are already silent. Fixing them is a
component-lifecycle change each, in three different features, with no test
coverage to catch a mistake (`src/` renders no components in its suite — FU-B11).
Bundling four such changes into a lint cleanup is how a green gate ships a
regression.

**The uncomfortable part, stated plainly:** the codebase now handles one rule two
different ways — four suppressions and one structural fix. That is worse than
either policy applied consistently, and it will read as arbitrary to whoever
finds it next. This entry is the explanation.

Two of the four are the same shape `RescheduleModal` had (reset-on-open in
`NodeModal` and `ClientModal`), so the same fix applies: gate the mount in the
parent, move the default into `useState`. `CallOutcomeModal`'s second effect and
`PhoneNumberInput` are genuine prop-sync effects and need more thought —
`PhoneNumberInput` also owns warning **W4** below, and the two should be looked at
together rather than separately.

**Do them one component at a time, each with its own commit and its own manual
check of the affected form.** Not one sweep.

### FU-EOS-10 · Three `exhaustive-deps` warnings, deliberately unchanged  → surfaced 2026-08-06 · 🟢 P3

Left after FU-EOS-4. Warnings, not errors, so they do not fail `npm run lint` or
the gate. Recorded because "we looked at these and chose to leave them" is worth
more than silence.

- [`Clients.tsx:308`](../../src/features/clients/pages/Clients.tsx#L308) — **leave
  alone.** Empty deps are deliberate and commented, guarded by `hasCleanedUrlRef`.
  Adding `navigate`/`searchParams` risks re-running a `navigate(..., { replace: true })`.
- [`CallOutcomeModal.tsx:67`](../../src/features/clients/components/CallOutcomeModal.tsx#L67)
  — harmless. The missing `initialFrequency` would only matter if it changed while
  the modal was open, which is not a reachable state.
- [`PhoneNumberInput.tsx:61`](../../src/shared/components/common/PhoneNumberInput.tsx#L61)
  — **the one worth revisiting (W4).** The effect fires only on `value` but its
  guard reads `phoneNumber` and `selectedCountry.code` from a closure captured on
  the previous `value` change, so it can compare against stale state and skip a
  sync it should perform. Low severity — the fields reconcile on the next `value`
  change — and pre-existing. Fixing it changes when the effect runs, in a control
  that already has a `set-state-in-effect` suppression (FU-EOS-9), so it is a
  behaviour change needing manual testing, not a lint tidy-up. Do it with FU-EOS-9.

---

### FU-EOS-11 · Firebase project shell still exists  → surfaced 2026-08-07 · 🟡 P2

The Firebase teardown closed the exposure but could not finish the job. **Hosting is
disabled** (`biztrack-5bf99.web.app` returns 404, was 200) and **Firestore is empty**
(the `users` collection was deleted; the collection list is now blank). What remains is
the project shell itself: project **`biztrack-5bf99`**, number **619216241031**.

**Why it was not deleted:** `firebase-tools` has no `projects:delete` command, and
`gcloud` is not installed on this machine. Project deletion is a Google Cloud console
action, or `gcloud projects delete biztrack-5bf99` if the SDK is ever installed.

**Still inside it:** 4 Firebase Auth accounts — `1702mkothari@gmail.com`,
`mananmaheshwari1702@gmail.com`, and two that are **not** the owner's,
`thakourabhishek@gmail.com` and `atulkothari23@gmail.com`. `firebase-tools` has no bulk
auth delete, so these go when the project does. They can authenticate, but there is no
longer an app to load or data to read.

**Why P2 and not P1:** the reachable attack surface is already gone. This is
housekeeping and a small ongoing bill, not an open door.

**Also worth doing while in the console:** the account holds a second unrelated project,
`studio-2587205304-c885c` ("Firebase app"), which nothing in Biztrack references.

### FU-EOS-12 · Dev stack exists in code but has never been deployed  → surfaced 2026-08-07 · 🟡 P2

`BiztrackStack-dev` synthesizes cleanly (exit 0, 28 `-dev` resources, 0 reserved
concurrency, disposable table) but **has never been deployed**. There is therefore still
no dev environment, and `.env.development.local` still points at production — the exact
condition FU-B6 exists to end.

**Why it was left:** deploying creates real infrastructure including a CloudFront
distribution, which is a spend and a footprint decision, not a cleanup side effect.

**To land it:**

```
cd infra && npx cdk deploy BiztrackStack-dev
```

Then point `.env.development.local` at the dev stack's outputs (`UserPoolId`,
`UserPoolClientId`, `CognitoDomain`, `ApiUrl`) and sign up a fresh dev user — the pool
starts empty, and the PostConfirmation trigger creates the profile.

**Cost:** near zero while idle. DynamoDB is pay-per-request against an empty table and
Lambda scales to zero; CloudFront and the Cognito domain are the only standing items.

**One rough edge, deliberately left:** the dev stack still carries the WhatsApp scheduler
(EventBridge, every minute) and the daily purge Lambda. Against an empty table they do
nothing, but they do invoke. Disable them in dev if the invocation noise ever matters.

## Group B — deferred backlog (feature/infra work, not gating correctness)

### FU-B1 · ~~Enable Phase C reserved concurrency~~ — RESOLVED 2026-08-06  → item 3 (B4)

Implemented with FU-0; deploy with `cdk deploy -c reserveConcurrency=true`. The total is
**267**, not the 239 recorded here previously — that figure was one revision stale, predating
the invoices handler, and two values were corrected on evidence before shipping:

- **`whatsapp-scheduler` 2 → 5.** "One invocation/minute, 2 covers run-overlap" counted the
  EventBridge tick but not Lambda's async retry policy. Measured peak was **3** concurrent
  during the 2026-08-05 outage (180 invocations/hour against a rule firing 60/hour). A
  reservation of 2 would have throttled the third retry — and throttled async invokes retry
  again, stacking a second amplification loop on the one the number missed.
- **`health` unreserved → 5.** The old comment said it must "answer even when the app is being
  throttled", which is the right goal by the wrong mechanism: unreserved means no floor, so the
  probe was throttled alongside everything it reports on. A reservation is what guarantees it.

Throttles were loosened at the same time, but bulk paths went to **5/10, not the 10/20** the
in-code comment projected — 10 req/s sustained against a 20s wall-clock guard would demand 200
concurrent versus a `clients` reservation of 50. **Do not raise the bulk rate limits without
re-sizing `clients` and `products` first.**

Re-tune on trigger, not on a calendar: any per-function `Throttles > 0`, sustained concurrency
above 60% of a reservation, or any change to the API Gateway rate limits.

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

### FU-B6 · Separate dev stack  → from the C3 CORS lockdown — **UNBLOCKED 2026-08-07, not yet deployed**

> **2026-08-07 — the parameterization landed; the deploy did not.** Every name in the
> blocker table below is now suffixed from an `envName` prop on the stack, and
> `infra/bin/infra.ts` declares both `BiztrackStack` and `BiztrackStack-dev`.
>
> **The hazard flagged further down was taken seriously and is cleared.** `env=prod`
> resolves to an **empty** suffix by construction, so every production name is the
> byte-identical string it was before. Proof, not intent: `cdk diff BiztrackStack`
> reports exactly **one** change — `DeletionProtectionEnabled: true` on the table — with
> **zero replacements and zero physical-name changes**. `cdk synth BiztrackStack-dev`
> emits 28 correctly `-dev`-suffixed names.
>
> Two things the parameterization also fixed, both cross-environment safety rather than
> naming: the dev pool does not list the production CloudFront origin as an OAuth
> callback, and dev emits **zero** reserved concurrency — a dev stack reserving 267 would
> have drawn from the same account pool as prod and could have throttled it.
>
> **What remains is the deploy itself**, which creates real resources and is the owner's
> call. Tracked separately as **FU-EOS-12**. Until then there is still no dev
> environment and the interim answer below is still the live one.

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
