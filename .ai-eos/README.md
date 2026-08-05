# AI Engineering Operating System

The starting point for every project. Copy `templates/new-project/` and go.

> ## THE ONE RULE
>
> **Every new standard must remove work, or create more value than the work it adds.
> Measured over five years, across every app we will ever run.**
>
> This governs everything else here, including this file. Before adding a file, a
> section, a rule or a process, answer: *what does it remove, or what does it make
> possible that wasn't?* "It seemed useful" is not an answer.
>
> It applies to **rules**, not to **facts**. `DOMAIN-INDIA.md` and `fleet/REGISTRY.md`
> grow because reality grows. That is recording, not complexity.

---

## Three workflows — pick one deliberately

They differ in their default answer to *"should I change this code?"* An agent given
the wrong one will do the wrong thing confidently.

**Two prompts. You never paste more than one line.**

```
Read .ai-eos/AGENTS.md, then execute .ai-eos/commands/new-project.md
Read .ai-eos/AGENTS.md, then execute .ai-eos/commands/adopt-project.md
```

| | When | Entry point | Default answer to *"should I change this code?"* |
|---|---|---|---|
| **New** | Starting from nothing | `commands/new-project.md` | **Yes** — you are writing it |
| **Adopt** | An existing project that works | `commands/adopt-project.md` | **No**, unless approved |
| **Review** | Finished work, before a release | `review/README.md` | **Never** — you are reading |

Keeping these separate is how stable production code avoids being rewritten by
accident. An agent handed the wrong one will do the wrong thing confidently.

Review is not a third command: it is already seven agent prompts under `review/`, and
a command file pointing at them would be indirection with no content. There is
deliberately no "fix the review findings" command either — the synthesis report ends
by naming the three things to do first, and `SHARED_RULES.md` § The ratchet says what
becomes a `verify.sh` check. A command would only restate both.

---

## The shape of the system

```
AI-Engineering-Operating-System/
├── AGENTS.md          ← the only file every AI reads every time. ~750 tokens.
├── CLAUDE.md          ← one line: @AGENTS.md
├── GEMINI.md          ← one line: @AGENTS.md
├── README.md          ← this router
├── MIGRATION.md       ← why adoption works the way it does
│
├── commands/          ← the only two prompts. Version-controlled, never pasted.
│   ├── new-project.md
│   └── adopt-project.md
├── VERSION.md         ← the only place any version number lives
├── EMERGENCY.md       ← printed, in the safe
│
├── standards/         ← company law. Changes rarely, deliberately, by ADR.
│   ├── BUILD.md           how we build
│   ├── OPERATE.md         how we deploy and run (NAS + AWS)
│   ├── SECURITY.md        exposure, secrets, access
│   ├── DOMAIN-INDIA.md    money, FY, PAN/GSTIN, tax — the knowledge in our heads
│   └── DECISIONS.md       ADRs, deferrals, and the standing rejection list
│
├── platform/          ← the five contracts, and the shared code behind some of them
│   └── PLATFORM.md        health · auth · error · logging · backup
│
├── templates/         ← copied, not read
│   └── new-project/       the scaffold. This IS the standard, executable.
│
├── review/            ← multi-agent review, run before a release
│
└── fleet/             ← running 100 apps with two people
    ├── FLEET.md           the operations model
    ├── REGISTRY.md        generated inventory — never hand-edited
    └── scripts/           new-app · fleet-status · fleet-patch · fleet-verify
```

**Twelve documents and two commands a human maintains.** Everything else is a template, a script, or
generated. If you are about to add an eleventh, re-read The One Rule.

---

## Document, command, script

Three artefact types, no overlap. **If something appears in two of them, one is wrong.**

| Artefact | Job | Changes when |
|---|---|---|
| **Document** | Explains *why* | The reasoning changes |
| **Command** | Instructs an AI | The procedure changes |
| **Script** | Enforces without asking | A check is added |

---

## Read order

**AI, starting any task:** `AGENTS.md` only. It is auto-loaded. For most tasks
that is enough — stop there. Load a standard only when the task table in
`AGENTS.md` says to, and grep to a heading rather than reading the whole file.

**Human, starting a project:** `fleet/scripts/new-app.sh <name>`, then answer what
it asks. It writes the scaffold; you do not create folders by hand.

**Human, coming back after six months:** `fleet/REGISTRY.md` (what exists), then
that project's `docs/PROJECT.md`, then `docs/LOG.md` from the bottom up.

**Somebody else, in an emergency:** `EMERGENCY.md`.

---

## Question → file

| Question | Go to |
|---|---|
| What is running, where, on what URL? | `fleet/REGISTRY.md` |
| How do I start a new app? | `commands/new-project.md` |
| How do I bring an existing app into the standard? | `commands/adopt-project.md` |
| Why does adoption work that way? | `MIGRATION.md` |
| When may I create an abstraction? | `standards/BUILD.md` §8 — Rule of Three |
| Where does `.ai-eos/` go, and why is `AGENTS.md` at root? | `MIGRATION.md` § Where the standard lives |
| What columns does every table need? | `standards/BUILD.md` § Database |
| Can I ship this? | run `./verify.sh` in the project |
| How do I deploy to the NAS / to AWS? | `standards/OPERATE.md` |
| Is this app allowed on the public internet? | `standards/SECURITY.md` § Exposure |
| Which quarter is 15 May? | `standards/DOMAIN-INDIA.md` |
| Why is the API not on a subdomain? | `standards/DECISIONS.md` ADR-005 |
| How do I patch all 100 apps? | `fleet/FLEET.md` § Fleet operations |
| Can I fork the backup module? | No. `platform/PLATFORM.md` |
| What must `/api/health` return? | `platform/PLATFORM.md` § Health contract |
| What version is app #92 on, and what does it need? | `VERSION.md` |
| Should we use Kubernetes / CQRS / an event bus? | `standards/DECISIONS.md` § Standing rejections |
| Full review before a release | `review/README.md` |
| NAS is dead / I am locked out / ransomware | `EMERGENCY.md` |
| May I add a rule? | The One Rule, above, then `standards/DECISIONS.md` |
| May I add a rule **to `AGENTS.md`**? | `standards/BUILD.md` §12 — two tests, and something must leave |

---

## What changed from the old system, and why

The previous `@CORE DOCUMENTS/` was built for one chartered accountant running six
internal apps on one NAS. It was good at that. It does not survive contact with
100 client-facing deployments run by two people.

Removed, merged or demoted: 11 core documents → 10, but with a different split —
`03-APP-DOC-TEMPLATES` became real files instead of a document describing files;
`06-AI-CONTEXT` Part A became auto-loaded `AGENTS.md` and Part B merged into
`review/`; `07-ADMIN-MANUAL` and `08-TEAM-MANUAL` were deleted (joiner/mover/leaver
process for two founders is ceremony); `09-REGISTERS` became generated.

Added because 100 apps needs it: `platform/` and `fleet/`.

Full reasoning, and every challenge to the old assumptions, is in
`AI-EOS-DESIGN-RATIONALE.md` beside this folder. Read it once, then never again.
