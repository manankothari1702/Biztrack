# COMMAND — ADOPT AN EXISTING PROJECT

Run with: `Read .ai-eos/AGENTS.md, then execute .ai-eos/commands/adopt-project.md`

Reasoning behind every phase, and what to do when adoption is the wrong call at all:
`.ai-eos/MIGRATION.md`. This file is the instruction; that one is the explanation.

---

You are the Lead Software Architect and Platform Engineer for our company. This
repository contains an application that **already works**.

Your mission is to adopt it into AI-EOS. **Not to rewrite it.**

> **The application is the priority. AI-EOS is the standard.**
>
> A working application that deviates from the standard is worth more than a
> standards-compliant application that broke on a Tuesday. Never rewrite stable code
> because a different architecture exists.

---

## PHASE 0 — Baseline. Do not skip.

1. `git checkout -b adopt-ai-eos` and tag the current commit.
2. Run the existing test suite. **Record what passes and what ALREADY FAILS.**
3. Record whether the app builds, starts, and serves traffic.
4. Commit that baseline before touching anything.

**"Tests still pass" is meaningless without this.** Legacy projects usually have red
tests already. An agent that finds them will either "fix" unrelated code or report the
adoption as broken — both waste a day.

## PHASE 1 — Load context, correctly

Read `.ai-eos/AGENTS.md`. Follow its routing table; load a standard only when a
specific comparison needs it, and grep to the heading.

**Do not read the whole operating system up front.** That costs tens of thousands of
tokens and produces no better audit than routing does.

Change nothing in this phase.

## PHASE 2 — Audit

Describe what exists, **without judging it**: architecture · deployment · Docker ·
environment variables · database · authentication · logging · testing ·
documentation · release process.

Change nothing in this phase.

## PHASE 3 — Compare, classify, then STOP

Produce a table. Every difference from AI-EOS gets exactly one classification:

| | Means |
|---|---|
| **✓ SAFE TO ADOPT** | Additive or documentation-only. Cannot break running behaviour. |
| **⚠ NEEDS DISCUSSION** | Touches running state, naming, structure, or a public interface. |
| **✗ KEEP EXISTING** | The app's way is fine or better. Say why. |

Explain every recommendation.

**Genuinely safe:** the three documents · root `AGENTS.md` importing `.ai-eos/` ·
`verify.sh` and the pre-commit hook · a **new** `GET /api/health` endpoint ·
`.gitignore` and `.env.example` completeness · structured logging *added alongside*
existing logging · security headers at the ingress · pinning dependency versions.

**Never "safe", however tempting — classify these ⚠ NEEDS DISCUSSION:**

- Folder restructuring. Moving files breaks imports, Docker `COPY` paths, CI config
  and volume mounts, and buys nothing a client can see. Highest risk, lowest value.
- **Renaming or removing environment variables** — "env var cleanup" breaks the
  running deployment the moment it restarts. Adding a variable is safe; touching an
  existing one is not.
- Renaming containers, networks or volumes. A renamed volume bound to `pgdata` is
  data loss.
- Changing API paths, response shapes or error formats (`BUILD.md` §6).
- **"Deployment improvements"** that alter how the app is currently released.
- Splitting files, extracting abstractions, swapping a working library for the
  standard one, or adding a migration framework to an existing schema in one step.

> **⛔ STOP HERE. Output the table and wait for approval.**
> Do not begin Phase 4. Without this stop an agent classifies and implements in one
> breath, and the classification becomes decoration. This is the most important line
> in this file.

## PHASE 4 — Adopt, one category at a time

Only what was approved. Ordered by **reversibility** — reverting a document costs
nothing; reverting a renamed environment variable costs a broken deployment at 11pm.

```
1 documentation   2 tooling   3 observability
4 deployment      5 configuration            6 code
```

**One category per commit. Verify between each. Never batch across categories** — when
something breaks you need to know which change did it.

**Most existing apps should stop after 3.** Stopping early is a successful outcome,
not an incomplete one.

Do not: rewrite architecture · rename large parts of the project · introduce
abstractions · split files for style · create repositories, services, factories,
managers or interfaces without immediate value · break an API · change behaviour a
user depends on.

## PHASE 5 — Verify against the baseline

- The app builds, starts, and serves traffic
- **Tests are no worse than the Phase 0 baseline**
- Docker builds; deployment works — on staging first
- Nothing that previously worked now needs a manual step
- `./verify.sh` — treat its failures as a to-do list, not a blocker

Then record it in **two places, and create no new document:**

- **`docs/LOG.md`** — one entry: what was adopted, what was skipped, what broke and
  how it was fixed. Adoption is an event; events go in the log.
- **`docs/PROJECT.md` §8** — every KEEP EXISTING deviation with its reason. This is
  durable reference, not history: it answers *"why doesn't this app have X?"* for the
  next five years. Without it, someone re-litigates each deviation annually.

Remaining technical debt and future recommendations become **issues in this
repository**, not prose in a document — that is where the person doing the work will
see them (`DECISIONS.md` ADR-028).

---

## NON-NEGOTIABLE

Never refactor for appearance. Never migrate for style. Never rewrite because code is
old.

**If working code already satisfies the engineering intent, leave it alone.**

Every proposed change must reduce maintenance over the next five years. If it does
not, do not make it.

When two implementations are equally correct, choose the simpler one. Prefer stability
over architectural purity.

**If adopting something would require changing working code, stop and ask.**
*"This app deviates from the standard, deliberately"* is an acceptable and common
outcome — it belongs in `PROJECT.md` §8, not in a backlog.

The goal is not a perfect project. It is a stable project that follows AI-EOS while
preserving production reliability.
