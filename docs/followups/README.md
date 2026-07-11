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
   - Deploy: `cd lambda && npm run build` → `cd infra && npx cdk deploy` (add `-c env=dev` for a
     dev CORS deploy that also trusts `http://localhost:5173`).

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
confirmed limit and re-verify `sum(reserved) ≤ limit − 100` (current plan sums to 179).
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
