# Multi-agent review

Independent reviewer personas, each with a narrow remit, run in **separate fresh
sessions**. Synthesis merges them last.

Run each agent in its own session. An independent review only has value if each
persona checks for itself; run them back to back in one session and the later agents
quietly trust what the earlier ones forgave.

---

## When to run which

`verify.sh` runs on every push and is the automated floor. This is the human-judgment
layer above it — for what a script cannot check.

| | When | Agents |
|---|---|---|
| **Quick** | After a normal feature lands | `engineer` → fix → `qa` → fix → `simplicity` |
| **Full** | Before a client sees it, before production, before a platform major release | `ui` · `engineer` · `qa` · `security` · `product` · `simplicity` → `synthesis` |

Most features get Quick. Full is expensive and is meant to be — reserve it for the
moments where a bug becomes someone else's problem.

**Never run either instead of `verify.sh`.** They are different layers: the script
catches regressions in seconds, the agents catch judgment errors in an hour.

And they feed each other in one direction. **Anything a review finds that a script
could have found becomes a new `verify.sh` check** (`SHARED_RULES.md` § The ratchet).
Over time the script absorbs the mechanical findings and the agents are left with the
work only judgment can do — which is the only way six agents stay affordable across a
hundred apps.

---

## How to run one

```
Read AI-Engineering-Operating-System/review/SHARED_RULES.md
and  AI-Engineering-Operating-System/review/agents/engineer.md
Review this project.
```

Save each report. When all exist, run `agents/synthesis.md`.

---

## Files

```
review/
├── README.md          this
├── SHARED_RULES.md    evidence rules + the report structure every agent uses
└── agents/
    ├── ui.md          a real person using this, not the code
    ├── engineer.md    hiring-bar code review
    ├── qa.md          break it, don't confirm it
    ├── security.md    narrow — skips what a prior audit covered
    ├── product.md     against the decisions actually made, not best practice
    ├── simplicity.md  every line is a liability
    └── synthesis.md   merge, resolve conflicts explicitly, decide
```

---

## What was merged into this

The old `06-AI-CONTEXT.md` Part B prompt library held nine prompts. Four duplicated
agents here (B5 security ≈ `security.md`, B6 testing ≈ `qa.md`, B8 code review ≈
`engineer.md`, B4 frontend ≈ `ui.md`) — their fleet-specific checks were folded into
those agents rather than kept as a second copy.

The rest were deleted with reason: **B1 architect, B2 database, B3 backend** are
build-time prompts now covered by `standards/BUILD.md` and the scaffold; **B7
documentation** is covered by "done means a `docs/LOG.md` entry"; **B9 catch-up** is
covered by the read order in `AGENTS.md` (`docs/PROJECT.md`, then `docs/LOG.md`
bottom-up).

Two copies of a prompt is worse than one, because you never know which was updated.
