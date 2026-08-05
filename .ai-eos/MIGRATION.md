# ADOPTING AI-EOS INTO AN EXISTING PROJECT

**Creating a new project and adopting an existing one are different tasks.**
`fleet/scripts/new-app.sh` is for the first. This document is for the second.

> ## THE GUIDING PRINCIPLE
>
> **The project is the priority. AI-EOS is the standard.**
>
> A working application that deviates from the standard is worth more than a
> standards-compliant application that broke on a Tuesday. Adoption is something we
> do *to* the documentation, deployment and configuration around an app — and only
> reluctantly to the app itself.

---

## Before anything: should this app adopt at all?

Adoption is not free and not always right. Answer honestly:

| | Adopt | Leave alone |
|---|---|---|
| Will it be actively developed in the next 6 months? | yes | no |
| Does a client depend on it right now? | yes — adopt carefully | — |
| Is it on a stack the standard covers (Docker, Postgres, Python/React)? | yes | no — it will fight you at every step |
| Would you rebuild it from scratch inside two weeks? | | **rebuild instead** |

**A stable app nobody is touching should stay in 🔵 Steady and adopt nothing except
security patches.** `BUILD.md` §11 already says do not migrate a working app for
tidiness; this is the same rule at the whole-app level. A legacy app on a different
stack entirely — Apps Script, a PHP tool, a spreadsheet — should be left alone or
rewritten, never "brought into line."

Partial adoption is a legitimate outcome. An app that gains `/api/health`,
`verify.sh` and three documents but keeps its own folder layout is a success.

---

## Where the standard lives in the project

Vendor the whole standard into the repository as `.ai-eos/`. It travels with the
code, works offline, and pins that app to a known standard version.

```
CRM/
├── .ai-eos/          ← this standard, vendored. Read-only. Never hand-edited.
├── AGENTS.md         ← the project's own. Imports .ai-eos/AGENTS.md. MUST be at root.
├── CLAUDE.md         ← @AGENTS.md
├── GEMINI.md         ← @AGENTS.md
├── docs/
├── backend/
├── frontend/
└── docker-compose.yml
```

> ### ⚠ `AGENTS.md` must stay at the repository root
>
> Claude Code, Codex and Gemini CLI auto-load context from the **root**. Put the only
> copy inside `.ai-eos/` and nothing loads automatically — you are back to asking a
> human to remember, which is the 80%-compliance failure ADR-027 exists to remove.
>
> So: the standard lives in `.ai-eos/`, and a small project `AGENTS.md` at root
> imports it. Both, not either.

`.ai-eos/` is a copy, so a hundred apps hold a hundred copies. That is intentional and
handled: each app records its version in `docs/PROJECT.md`, `VERSION.md` says what
changed between versions, and `fleet-patch.sh` pushes an update across apps on your
schedule. **Never hand-edit `.ai-eos/` inside a project** — fix the source and
re-patch, or the app silently forks the standard.

---

## The five phases

Order is by **reversibility**, not by importance. Reverting a document costs nothing.
Reverting a renamed environment variable costs a broken deployment at 11pm.

```
AUDIT  →  COMPARE  →  ⛔ STOP  →  ADOPT  →  VERIFY
 read      classify    a human     safe only   prove nothing broke
 only                  decides
```

### Phase 0 — Baseline (do not skip)

Before reading anything else:

1. Branch: `git checkout -b adopt-ai-eos`, and tag the current commit.
2. **Record what already works** — run the test suite and write down what passes *and
   what already fails*. Note whether the app builds, starts, and serves traffic.
3. Save that baseline in the branch.

**"Tests still pass" is meaningless without this.** Legacy projects usually have
failing tests already, and an agent that finds them will either "fix" unrelated code
or report the adoption as broken. Both waste a day.

### Phase 1 — Read the standard

`.ai-eos/AGENTS.md`, then whatever it routes to. Nothing is changed in this phase.

### Phase 2 — Audit

Describe what exists, without judging it: architecture, deployment, Docker,
environment variables, documentation, folder structure, testing, security, logging,
and how it is currently released. **No changes.**

### Phase 3 — Compare, then stop

Produce a table. Every difference gets exactly one classification:

| Class | Means |
|---|---|
| **SAFE TO ADOPT** | Additive or documentation-only. Cannot break running behaviour. |
| **NEEDS DISCUSSION** | Touches running state, naming, structure, or public interfaces. |
| **LEAVE AS-IS** | The app's way is fine, or better. Record why — it becomes a `PROJECT.md` §8 entry. |

> ### ⛔ Phase 3 ends the session.
>
> Hand the table to a human and stop. Without a hard stop an agent rolls straight
> from classifying into implementing, and the classification becomes decoration. This
> is the single most important line in this document.

**What is genuinely SAFE TO ADOPT:**

✓ The three documents (`PROJECT.md`, `RULES.md`, `LOG.md`) · ✓ `AGENTS.md` at root ·
✓ `verify.sh` and the pre-commit hook · ✓ `GET /api/health` (a *new* endpoint breaks
nothing) · ✓ `.gitignore` and `.env.example` completeness · ✓ structured logging
*alongside* existing logging · ✓ security headers at the ingress · ✓ pinning
dependency versions

**What is NOT safe, however tempting:**

✗ **Folder restructuring** — moving files breaks imports, Docker `COPY` paths, CI
config and volume mounts, and buys nothing a client can see. This is the highest-risk,
lowest-value change available and it belongs in NEEDS DISCUSSION, never in SAFE.
✗ Renaming environment variables — breaks the running deployment the moment it restarts
✗ Renaming containers, networks, volumes — `pgdata` bound to a renamed volume is data loss
✗ Changing API paths or response shapes — `BUILD.md` §6 applies
✗ Splitting files, extracting abstractions, "modernising" — no
✗ Swapping a working library for the standard one
✗ Adding the ORM/migration scheme to an app with an existing schema, in one step

### Phase 4 — Adopt, one category at a time

**One category per commit, verify between each.** Never batch across categories — when
something breaks you need to know which change did it.

```
1. Documentation      (zero risk — do all of it)
2. Tooling            verify.sh, hooks, .gitignore, .env.example
3. Observability      /api/health, structured logging   (additive)
4. Deployment         ingress labels, security headers  (test on staging first)
5. Configuration      env var names                     (only with a planned restart)
6. Code               only what Phase 3 explicitly approved
```

Stop at whatever level the app has earned. **Most existing apps should stop after 3.**

### Phase 5 — Verify against the baseline

- `./verify.sh` — expect failures; they are a to-do list, not a blocker
- The app still builds, starts, and serves traffic
- **Tests pass exactly as they did in the Phase 0 baseline** — no worse
- Deployment still works, on a staging target first
- Nothing that previously worked now needs a manual step

Then record it in **two** places, and no new file:

- `docs/LOG.md` — one entry: what was adopted, what was left, what broke and how it
  was fixed. Adoption is an event, and events go in the log.
- `docs/PROJECT.md` §8 — every LEAVE AS-IS deviation, with its reason. This is durable
  reference, not history: it answers "why doesn't this app have X?" for the next five
  years, and without it someone re-litigates each deviation annually.

*(A separate `MIGRATION.md` per project was considered and rejected — a fourth
document that is written once and read never, when two existing documents already
have exactly the right shape.)*

---

## Running it

The prompt lives in **`commands/adopt-project.md`**, not here. Paste this:

```
Read .ai-eos/AGENTS.md, then execute .ai-eos/commands/adopt-project.md
```

**This document explains; that one instructs.** Two copies of a prompt is worse than
one, because you never know which was updated — so the phases above are the reasoning
and the command file is the executable version of them. Change the command when the
procedure changes; change this document when the *reasoning* changes.

That split runs through the whole system:

| Artefact | Job | Example |
|---|---|---|
| **Document** | Explains why | `MIGRATION.md`, `BUILD.md`, `PLATFORM.md` |
| **Command** | Instructs an AI | `commands/adopt-project.md` |
| **Script** | Enforces without asking | `verify.sh`, `new-app.sh` |

If something is in two of these, one of them is wrong.

## The three workflows

Keep them separate. Mixing them is how stable production code gets rewritten by
accident.

| | When | Entry point |
|---|---|---|
| **New** | Starting from nothing | `commands/new-project.md` (which runs `new-app.sh`) |
| **Adopt** | An existing project that already works | `commands/adopt-project.md` |
| **Review** | Finished work, before a release | `review/README.md` |

They differ in their default answer to "should I change this code?" — **New:** yes,
you are writing it. **Adopt:** no, unless approved. **Review:** never, you are reading.
An agent given the wrong one of these three will do the wrong thing confidently.
