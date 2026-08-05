# DECISION LOG

**Why things are as they are — and what was rejected.** Append only.

A standard says *what*. It does not stop an AI proposing something better-looking
next Tuesday. Without rejected alternatives recorded, every new session re-proposes
the separate API subdomain, the microservice split, the NoSQL database. You
re-argue it, you re-reject it, and six weeks later you do it again.

> **`Rejected alternatives` is the most valuable field.** It is the part that stops
> the loop.
>
> You may overturn anything here — some decisions will age badly. Overturn it
> *knowingly* and write a new ADR that supersedes the old one. Never silently
> re-decide.

**Format:** Status · Date · Impact · Decision · Reason · Rejected · Consequences
(**must include the downsides** — an entry listing only benefits is marketing) ·
Revisit when.

---

## IMPACT INDEX — read only what touches your work

| Working on | Read |
|---|---|
| Database schema | 002, 007 |
| API design | 005, 006, 023 |
| Deployment / infrastructure | 001, 003, 022, 026 |
| Security / access | 005, 023, 026 |
| Documentation | 024, 027, 028, 029 |
| Frontend | 030 |
| Proposing something new | 011–015 (the deferrals) + The One Rule in `README.md` |

| ADR | Title | Status |
|---|---|---|
| 001 | Self-host on NAS | **Amended by 026** |
| 002 | PostgreSQL, not spreadsheets | Accepted |
| 003 | One isolated Docker stack per app | Accepted — load-bearing |
| 004 | Port blocks of 10 | **Superseded by 022** |
| 005 | API on same origin under `/api/` | Accepted |
| 006 | FastAPI + React | Accepted |
| 007 | Soft delete everywhere | Accepted |
| 008 | Mandatory backup module in every app | **Amended by 023** |
| 009 | Four documents per app | **Superseded by 024** |
| 010 | Root docs consolidated | Superseded by this system |
| 011–015 | Deferrals: shared services, events, mobile, desktop, platform | 011 and 015 **partly reversed by 023**; 012–014 stand |
| 016 | Two operating manuals | **Superseded by 029** |
| 017 | Emergency recovery as its own file | Accepted |
| 018 | Git per project | Accepted |
| 019 | Role scope per project, names fixed | Accepted |
| 020 | Docs in folders, never loose | Superseded by the scaffold |
| 021 | We are a software company, not a CA practice with software | **New — the root change** |
| 022 | Label-routed ingress replaces port allocation | New |
| 023 | Extract the platform now, not after three apps | New |
| 024 | Three documents per app, two AI-generated | New |
| 025 | `verify.sh` replaces the twelve manual gates | New |
| 026 | NAS for internal, cloud for client-facing | New |
| 027 | `AGENTS.md`, auto-loaded, replaces the paste block | New |
| 028 | Registers are generated, never maintained | New |
| 030 | One design system for the fleet | New |

Decisions 001–020 were made for a chartered accountant running six internal apps on
one NAS. They were correct for that. The ones marked superseded broke at a hundred
client-facing deployments — the reasoning is in each new entry below, because
knowing *why a good decision stopped being good* is worth more than the decision.

---

## ADR-021 — We are a software company, not a practice with software
**Accepted** · 2026-08-03 · Impact: everything

**Decision:** The documentation system serves a two-founder company shipping isolated
SaaS applications to unrelated business clients, targeting 100+ deployments. It no
longer serves one CA practice running six internal tools.

**Reason:** Every superseded decision below traces to this. The old system assumed
one domain (Indian tax), one operator, one network, one set of staff, and a document
count that a human could hold in their head. Three of those five stop being true at
scale, and the two that remain — one domain, one operator pair — remain only by
choice.

**Rejected:** *Keep the old structure and grow it.* Eleven documents at six apps
becomes eleven documents plus a hundred app folders, with hand-maintained registers
that go stale in week three and are never trusted again. The failure mode is not
that the documents get worse — it is that people stop believing them.

**Consequences:** ✅ Every rule below is now testable against "does this survive a
hundred apps and two people?" ❌ **Indian tax knowledge is kept fleet-wide by
choice, not by nature.** If a non-Indian client ever appears, `DOMAIN-INDIA.md` must
be demoted to a per-project concern, and that will be an awkward afternoon. ❌ Work
that was previously informal (client contracts, data retention, incident response)
is now obligatory, because the data belongs to somebody else.

**Revisit when:** a client outside India, or a second product line that shares
nothing with the first.

---

## ADR-022 — Label-routed ingress replaces port allocation
**Accepted** · 2026-08-03 · Impact: Deployment · Security · **Supersedes ADR-004**

**Decision:** Apps publish no host ports. A single reverse proxy per host (Caddy or
Traefik) discovers containers by Docker label and issues TLS itself. The port
register is deleted.

**Reason:** ADR-004 chose blocks of ten so that `8134` is obviously GST's. At six
apps that is readable. At a hundred it is a thousand hand-allocated ports in a table
that must be correct, is edited by hand, and is consulted under time pressure —
`port is already allocated` was already the second-commonest deployment failure.

More importantly, the register was only one of five manual steps per app: allocate
port → write it in the register → create a DSM reverse-proxy rule → add the hostname
to the certificate SAN → add a DNS record. Label routing removes the first four.
**At a hundred apps that is four hundred manual steps deleted, each one an
opportunity to get it wrong at 11pm.**

**Rejected:** *Keep blocks of ten* — works, but every one of the five steps stays,
and the register is hand-maintained forever. *A port range per host with automatic
allocation* — solves the register but keeps the proxy and certificate steps, so it
buys a third of the benefit for most of the work.

**Consequences:** ✅ Deploying an app is `docker compose up` and nothing else. ✅ TLS
renewal stops being a calendar reminder. ❌ **One more piece of infrastructure to
understand**, and when it breaks, every app on that host is down at once — a shared
failure domain we did not previously have. ❌ Debugging is now "check the proxy's
view of the world," not "curl the port." ❌ Existing v2.x apps publish host ports and
need a compose change to migrate (`BUILD.md` §11).

**Revisit when:** the proxy itself becomes the recurring cause of outages, or a
client requires a network topology it cannot express.

---

## ADR-023 — Extract the platform now, not after three apps
**Accepted** · 2026-08-03 · Impact: Architecture · Security · **Amends ADR-008, partly reverses ADR-011 and ADR-015**

**Decision:** Auth, backup, ingress and the UI kit become shared, versioned artefacts
that every app pins, immediately — before app #2. Everything else stays duplicated
and is extracted only when three apps demonstrably share it, exactly as ADR-015 said.

**Reason:** ADR-015's principle is right: extract from evidence, not imagination. Its
*conclusion* — wait for three live apps — assumed the evidence did not exist yet. It
does. `BUILD.md` **mandates** a backup module, the four roles, an auth flow and the
UI baseline in every app. Anything the standard already compels in all hundred apps
is proven universal by fiat; waiting for three instances to confirm what we have
already written down is ceremony.

The counting matters. ADR-008 chose deliberate duplication of the backup module —
"six identical modules beat six clever ones." At six apps, correct: a bug means six
edits, and a shared library is a shared failure domain. **At a hundred apps a bug in
the backup module means a hundred edits, which in practice means it does not get
fixed.** The crossover is somewhere around ten. We are heading well past it.

**Rejected:** *Extract everything into a platform now* — this is ADR-015's actual
warning, and it stands: eighteen months of infrastructure for applications that never
ship. *Wait for three apps* — correct for a general module standard, wrong for four
things the standard already mandates. *Shared runtime services (one auth server, one
backup service for all apps)* — a shared instance is a shared failure domain and
breaks ADR-003 isolation, which is the property we sell to clients.

**The distinction that makes this safe: shared image, isolated instance.** Every app
runs its own copy of the backup sidecar and its own auth integration. What is shared
is the *code*, versioned and pinned. One fix, one release, a hundred pinned upgrades
rolled out on your schedule — with no shared runtime failure domain.

**Consequences:** ✅ A security fix in auth or backup is one change plus a fleet
patch. ✅ Every app looks the same, so an AI moving between them is not re-learning.
❌ **A bad platform release can break a hundred apps at once.** Mitigated by
semantic version pinning, apps upgrading on their own schedule, and each app's
`verify.sh` gating the upgrade — but the risk is real and new. ❌ Platform code now
needs its own tests, changelog and release discipline: it is a product with a hundred
consumers, not a folder of helpers. ❌ Four things are now coupled across the fleet;
if one is wrong, it is wrong everywhere.

**Revisit when:** a fifth candidate for extraction appears. Apply the original test —
three apps must demonstrably share it, in code, not in plan.

---

## ADR-024 — Three documents per app, two of them AI-generated
**Accepted** · 2026-08-03 · Impact: Documentation · **Supersedes ADR-009**

**Decision:** `docs/PROJECT.md` (identity + how it works + this app's decisions),
`docs/RULES.md` (business rules this app owns), `docs/LOG.md` (append-only history).
The old `APP-README.md` and the durable half of `MANUAL.md` merge into `PROJECT.md`.
`dashboard-spec.md` is deleted (ADR-030).

**Reason:** ADR-009's four documents were right about *separation* and wrong about
*volume once multiplied*. The old `MANUAL.md` had 22 sections, of which the function
map, module map, data flow, and variable table are all derivable from code and go
stale within two commits. Documentation that lies is worse than documentation that is
absent, because it is trusted.

The Sync Rule — code change updates `MANUAL.md` + `PROGRESS.md` + `APP-README.md` in
the same session — is a threefold documentation tax on every change. At six apps
that is discipline. At a hundred it is the thing that quietly stops happening, and
once it stops for one app it stops for all of them.

**Kept**, because these cannot be derived from code and are what an AI actually needs:
purpose and who uses it · pseudo-code for every significant algorithm · business
rules and where each is enforced · hidden assumptions · edge cases explicitly *not*
handled · deployment facts.

**Rejected:** *One combined file* — the append-only log would bloat the reference
sections and nobody opens a 60 KB file in a hurry. *Keep four* — see above. *Zero,
generate everything from code* — the four "kept" items above are precisely the
things code cannot tell you, and they are the expensive ones to lose.

**Consequences:** ✅ One-third less documentation work per change, across a hundred
apps. ✅ What remains is the part that cannot rot into a lie. ❌ **Some genuinely
useful detail is no longer written down** — the module map in particular was helpful
for a cold start. The bet is that an AI reading the actual code beats an AI reading a
stale map of it. ❌ v2.x apps have four documents and will look inconsistent until
touched. Do not migrate them for tidiness (`BUILD.md` §11).

---

## ADR-025 — `verify.sh` replaces the twelve manual quality gates
**Accepted** · 2026-08-03 · Impact: Deployment · Documentation

**Decision:** The twelve gates become an executable script in every app, run locally
and in CI. A red `verify.sh` blocks the deploy. Only what genuinely cannot be
automated stays a human step, and that list is short.

**Reason:** The gates were excellent — binary, objective, honest about which ones get
skipped. But a checklist walked by hand a hundred times is walked properly perhaps
sixty. The two the old standard itself flagged as most-skipped (restore, soft-delete)
are both trivially scriptable. A gate a machine checks is a gate that is checked.

**Rejected:** *Keep them manual* — does not survive the multiplication. *Drop them* —
they are the reason the apps are trustworthy.

**Consequences:** ✅ The gate runs on every push, not once before release. ✅ A
regression is caught in minutes rather than at the next deploy. ❌ **`verify.sh` is
now load-bearing infrastructure**: a bug in it silently passes bad builds, so it
needs the same care as the platform. ❌ Writing it is real up-front work before app
#2 ships — this is the largest single cost in adopting this system.

---

## ADR-026 — NAS for internal, cloud for client-facing
**Accepted** · 2026-08-03 · Impact: Deployment · **Amends ADR-001**

**Decision:** The NAS runs internal tools, staging and our own apps. Anything a
paying client touches runs on AWS or a VPS, one instance per client, from the first
deploy.

**Reason:** ADR-001 was right for internal software: hardware already owned, data in
the firm's custody, marginal cost per app near zero. It also honestly listed the
costs — office internet and power as single points of failure, CGNAT on consumer
fibre, one box. Those costs are acceptable when the person inconvenienced is the
person who chose them. They become a liability the moment a client is paying for
uptime and has an SLA expectation, spoken or not.

There is also a hard ceiling nobody has hit yet: one Postgres container per app on a
DS923+ runs out of RAM somewhere around ten to fifteen apps (`OPERATE.md` §7). A
hundred apps was never physically going to fit.

**Rejected:** *All client apps on the NAS* — one power cut is a hundred client
outages and a hundred phone calls. *Retire the NAS entirely* — it is paid for, it is
excellent for staging and internal tools, and moving those to the cloud is a pure
recurring cost with no benefit. *Shared cloud instance for many clients* — cheaper,
but breaks ADR-003 isolation, which is the property that lets us tell a client their
data is separate.

**Consequences:** ✅ A client outage is scoped to one client. ✅ A client can be
offboarded, handed over or billed by pointing at one instance. ❌ **Real recurring
cost per client, from day one** — this must be in the pricing, and if it is not, the
hundredth client is unprofitable. ❌ Two environments to keep identical; drift
between them will happen and is caught only by `verify.sh` running in both. ❌ Cloud
operations is a skill neither founder currently exercises daily.

**Revisit when:** cost per client instance becomes material — at which point the
answer is fewer, larger instances hosting several clients' isolated stacks, not
shared databases.

---

## ADR-027 — `AGENTS.md`, auto-loaded, replaces the paste block
**Accepted** · 2026-08-03 · Impact: Documentation

**Decision:** One `AGENTS.md` at company level and one per project, auto-read by
Claude Code, Codex and Gemini CLI. `CLAUDE.md` and `GEMINI.md` are one-line imports.
The manual "paste this block at the start of every conversation" step is gone.

**Reason:** The old paste block was well designed and correctly kept under a page.
Its weakness was mechanical: it depended on a human remembering to paste it, every
session, across three different tools. A rule that is followed 80% of the time is a
rule that is silently broken 20% of the time, and the failure is invisible — the AI
just quietly does something non-standard.

**Rejected:** *Three separate context files, one per tool* — three copies drift, and
which one is authoritative becomes a real question at 11pm. *One long file with
everything* — it loads on every session across a hundred apps; every token in it is
paid for thousands of times, so it stays under 800.

**Consequences:** ✅ Impossible to forget. ✅ Project context and company context
compose automatically. ❌ **A hard size budget on the most important document**, and
saying something important in 700 tokens is harder than saying it in 3,000. ❌
Depends on each tool honouring its convention; if one changes, that stub changes.

---

## ADR-028 — Registers are generated, never maintained
**Accepted** · 2026-08-03 · Impact: Documentation · Deployment

**Decision:** `fleet/REGISTRY.md` is written by a script that inspects the running
fleet. It is never hand-edited. Open items live as issues in each project's repo.

**Reason:** A hand-maintained register of a hundred apps is wrong within a month, and
a register known to be wrong is consulted once, found wrong, and never trusted again
— at which point it is pure cost. The old system had already noticed this: its own
port register carried the note *"inherited assumptions — read the real published
ports and correct this table."*

The old `02` §14 already stated the principle correctly: **"reality wins, the
document is what's wrong."** Generating the document makes that automatic rather than
aspirational.

**Rejected:** *Keep maintaining it by hand* — see above. *No register at all* — you
genuinely need to answer "what is running, where, on what version, backed up when"
in one place, especially during an incident.

**Consequences:** ✅ Always true. ✅ Free to regenerate, so it is regenerated often.
❌ **The generator is now a dependency** — if it breaks, the register silently stops
updating, so it prints its own run timestamp prominently. ❌ Intent that lived in the
register (why an app is planned, what a decision is waiting on) has to move to repo
issues, which is a different habit.

---

## ADR-029 — No admin manual, no team manual
**Accepted** · 2026-08-03 · Impact: Documentation · **Supersedes ADR-016**

**Decision:** Delete both. Access rules collapse into `SECURITY.md` §3. Client-facing
user documentation is a per-project deliverable an AI generates from
`docs/PROJECT.md` when a client needs it.

**Reason:** ADR-016 split by audience, which was right — staff and administrator are
genuinely different readers. The premise has changed: there are two founders and no
staff. A joiner/mover/leaver process for a company that will not hire is exactly the
enterprise ceremony we said we do not want. `07` was also blocked on an undefined
permission model and had been sitting incomplete.

**Rejected:** *Keep them, empty, for later* — an unfilled process document is not a
process, and it makes the system look larger than it is. *Merge them into one* —
still a manual for readers who do not exist.

**Consequences:** ✅ Two fewer documents, neither of which was being used. ❌ **If we
hire, both need writing** — and they will need writing from scratch, not restored,
because these were written for a CA practice's staff, not a software company's. ❌
Client-facing user docs now depend on an AI generating them well at the moment a
client asks, rather than a template existing in advance. Acceptable: a real client's
questions are better input than a guess.

---

## ADR-030 — One design system for the fleet
**Accepted** · 2026-08-03 · Impact: Frontend · Documentation

**Decision:** `platform/ui-kit` holds the tokens, components, four data states, theme
toggle and admin pages. Apps consume it and may extend it. The per-app
`dashboard-spec.md` is deleted.

**Reason:** A hundred design specs is a hundred documents nobody reads and a hundred
opportunities for `padding: 15px` to disagree with `--space-4: 16px`. The old
standard identified that exact failure and tried to solve it with discipline
("tokens must match exactly"). Discipline does not multiply by a hundred. Shipping
the tokens as code makes the mismatch impossible rather than forbidden.

There is a commercial argument too: a hundred apps that look like one family is a
product line. A hundred apps that each look slightly different is a hundred one-offs.

**Rejected:** *Per-app specs* — the status quo, and the thing that fails. *No design
system, per-app free-form* — every app becomes a fresh argument about spacing, and
the generic-AI look wins by default.

**Consequences:** ✅ New app screens start correct rather than being reviewed into
correctness. ✅ An accessibility fix lands everywhere at once. ❌ **A client wanting
their own branding is now a real request**, not a default — the kit must support
theming from the start or this becomes the reason it gets forked, and a forked kit is
worse than no kit. ❌ The kit is on the critical path for every app; a bug there
blocks everything.

---

# DEFERRALS THAT STILL STAND

**ADR-012 — no event-driven architecture.** Apps call each other directly over
authenticated APIs. Event buses solve coordination across dozens of services and many
teams; this is a hundred *independent* apps that mostly do not talk to each other at
all. Revisit when three or more apps genuinely need to react asynchronously to the
same change **and** direct calls have caused a real problem, not an anticipated one.
Reach for Postgres `LISTEN/NOTIFY` first — no new infrastructure.

**ADR-013 — no mobile standard.** Responsive React is the mobile strategy. Revisit
when a specific workflow genuinely fails on responsive web — most likely field
document capture or offline access. Write the standard *from* that app.

**ADR-014 — no desktop standard.** A PWA covers a surprising amount of this first.

**Splitting this file into one ADR per file.** The *function* already exists — this
file is the operating system's own ADR log, and 021–030 are exactly "why the standard
changed." What is deferred is the **format**.

At thirty entries one file is right: one grep finds everything, and the impact index
and standing rejections are cross-cutting navigation that would be homeless in a
per-ADR scheme. The split becomes right when the cold half starts costing something.
ADR bodies are append-only and read rarely; the index, the recent decisions and the
standing rejections are read constantly. That asymmetry — a growing cold section
attached to a hot one — is the actual trigger, not the entry count.

**Revisit when this file passes ~40 KB** (it is currently ~30 KB, and it is already
the largest document in the system). The split then is **hot index, cold bodies**:
this file keeps the impact index, standing rejections, open questions and the last
ten or so decisions; superseded and historical entries move to
`standards/decisions/ADR-0NN.md`, one per file, linked from the index.

Note the path: `standards/decisions/`, beside its index — **not** a top-level `docs/`.
`docs/` already means "this app's documentation" in every project, and a second
meaning at OS level is the kind of small ambiguity that costs an afternoon two years
from now.

**ADR-015's principle, restated after ADR-023 narrowed it:** anything not already
mandated by `BUILD.md` in every app is extracted only when three live apps
demonstrably share it — in code, not in plan.

---

# STANDING REJECTIONS

**Read this before proposing any of the following.** These are not open questions and
they are not deferrals with a date — they are rejected until a specific, observable
trigger fires. An AI proposing one of these without citing the trigger has not read
this file.

The trigger column is the important half. A rejection without one is dogma, and dogma
ages badly. Each of these becomes correct at some scale; none of them is correct at
ours.

| Rejected | Solves a problem we do not have | Reopen when |
|---|---|---|
| **Kubernetes** | Scheduling and self-healing across a fleet of machines with a platform team | We run more than a handful of hosts *and* have automated the ones we have. Docker Compose on one instance per client is the correct shape until then. |
| **Microservices** | Independent deploy and scaling by separate teams | A single app has two parts with genuinely different scaling profiles **and** the monolith has caused a real outage. Note that our apps are *already* isolated from each other — this would mean splitting *within* one app. |
| **Event bus / message broker** | Async coordination across many services and teams | Three or more apps must react asynchronously to the same change **and** direct authenticated API calls have caused a real problem, not an anticipated one. Reach for Postgres `LISTEN/NOTIFY` first — no new infrastructure. (ADR-012) |
| **Generic repository pattern** | Swapping the database, and mocking in tests | We change database engine. We will not. A service function calling SQL directly is testable against a real Postgres in a container, which is a better test anyway. |
| **DDD / hexagonal / clean architecture** | Coordinating a large team around a complex domain nobody person holds | The domain outgrows one person's head — at which point `DOMAIN-INDIA.md` is the answer, not a layering scheme. Layers do not create domain knowledge; they relocate it. |
| **CQRS** | Read and write loads that need different data models | A single app's reads and writes have measurably diverged in shape or volume, with `EXPLAIN ANALYZE` output to show it. An index fixes this nine times in ten. |
| **Plugin framework** | Third parties extending our apps | A third party is actually extending one of our apps. A plugin system without plugins is the exact pattern `BUILD.md` §8 forbids. (ADR-011) |
| **A second language or framework in the stack** | A task Python and React are bad at | A specific task is genuinely a poor fit **and** the cost of two more toolchains to patch across the fleet is written down and accepted. |
| **An ORM with auto-migration** | Schema convenience during early development | Never, on client data. Forward-only SQL migrations are the rule (`BUILD.md` §3). |
| **More documents** | The feeling that something is undocumented | The One Rule is satisfied in writing: what does it remove, or what does it make possible? Prefer tightening an existing document. |

**How to overturn one properly.** State the trigger that fired, with evidence — an
outage, a profile, a client requirement, a measurement. Write an ADR. Then do it. The
list exists to stop the re-argument, not to stop the change.

> **This is where the philosophy is actually enforced.** "We value simplicity" written
> in a values section stops nothing, because every one of the above arrives with a
> good reason attached. A named rejection with a named trigger is a rule an AI can
> check itself against on a Tuesday afternoon.

---

# OPEN QUESTIONS

Each needs an ADR before the work it blocks starts.

| # | Question | Blocks | Decide by |
|---|---|---|---|
| Q-01 | Auth: a shared service, or a library each app embeds? ADR-023 commits to *shared code*; it does not settle *shared runtime*. A service gives instant cross-app disable; a library keeps apps independently available. | app #2 | before the platform is built |
| Q-02 | Where do frontend builds run — a laptop, or CI? A manual step is a forgettable step, and at a hundred apps it is forgotten. | every deploy | before app #2 |
| Q-03 | Client contract template: data location, access, backup frequency, termination. `SECURITY.md` §6 says we cannot take a client without answers. | first paying client | now |
| Q-04 | Per-client billing and cost tracking against instance cost (ADR-026). At what client count does the unit economics break? | pricing | before client #5 |
| Q-05 | Does any app scope a role by assigned client? If yes, a `client_assignments` table is needed in the platform, not per app. Decide the first time, not the third. | first app with a `user` role that is not global | before app #2 |
