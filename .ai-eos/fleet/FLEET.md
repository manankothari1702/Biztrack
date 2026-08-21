# FLEET OPERATIONS

**How two people run a hundred applications.**

This document did not exist in the old system, and its absence was the single largest
gap. Everything else described how to build and deploy *one* app well. Nothing
described what happens when there are a hundred of them and one of you is on holiday.

---

## The governing number

**Marginal cost per app.** Every decision in this system is judged against it:

| | Old system | This system |
|---|---|---|
| Manual steps to deploy a new app | ~18 (folder, ports, register, compose, proxy rule, DNS, SSL, checklist ×12) | 3 (`new-app.sh`, secrets, `verify.sh`) |
| Documents to write per app | 4, hand-written | 3, two AI-generated from the scaffold |
| Documents to update per code change | 3 (the Sync Rule) | 1 (`docs/LOG.md`) |
| Places a security fix must be applied | every app, by hand | one platform release + one fleet patch |
| Hand-maintained fleet-wide registers | 5 | 0 |
| Endpoints to poll to know an app's state | none defined | 1, identical everywhere |

**At a hundred apps, an hour of per-app work is two and a half working weeks.** That
is the arithmetic that should decide every argument about whether something is worth
automating.

---

## The three states an app can be in

| State | Meaning | What we owe it |
|---|---|---|
| 🟢 **Active** | Under development or recently changed | Full attention. Platform kept current. |
| 🔵 **Steady** | Live, working, nobody has asked for anything in months | **Security patches only.** Do not migrate it for tidiness. Do not "modernise" it. |
| 🟠 **Sunset** | Client leaving or product retired | Data export scheduled, deletion date written down, then it goes. |

**Most of a hundred apps will be Steady, and that is the goal, not a failure.** An
app nobody has to think about is the product working. The temptation to keep a
hundred apps on the latest of everything is the fastest way to have no time to build
the hundred and first.

The one thing Steady apps still get, without exception: security patches. That is why
`fleet-patch.sh` and `verify.sh` exist — patching an app you have not opened in a
year is only safe if a machine can tell you it still works.

---

## Fleet operations

Every one of these is a script. **If a routine task cannot be scripted, it will not
happen a hundred times** — that is the test for whether it belongs here at all.

| Script | Does | Run |
|---|---|---|
| `new-app.sh` | Scaffolds the project, repo, compose, docs, `verify.sh`. The standard, executable. | per new app |
| `fleet-status.sh` | Polls `/api/health` on every app — that one endpoint supplies version, platform version, standard version, database state, restarts and last backup. Adds host disk and cert expiry. Regenerates `REGISTRY.md`. | weekly, and during any incident |
| `fleet-verify.sh` | Runs each app's full `verify.sh` against its live deployment. Reports only failures. | weekly |
| `fleet-audit.sh` | `pip-audit` + `npm audit` across every repo. Reports above-low severity only. | monthly |
| `fleet-patch.sh` | Applies a platform version bump or dependency fix across a selected set of apps, running each `verify.sh` and stopping at the first failure. | on a security fix |
| `fleet-access-review.sh` | Lists every admin account in every app. | quarterly |
| `new-host.sh` | Provisions a cloud instance to the standard shape. | per client instance |

**Reports exceptions, not status.** A weekly report listing a hundred healthy apps is
a report nobody reads. A weekly report saying "three apps failed, here they are" is
one you act on.

---

## Rolling out a change to the fleet

Never all at once. The rollout is the safety mechanism.

1. **One app.** Preferably an internal one on the NAS. Full `verify.sh`.
2. **Five apps.** Mixed — one internal, one small client, one busy client. Wait a
   week. This is where a problem you did not predict shows up.
3. **The rest**, in batches, `verify.sh` gating each batch.
4. Any failure stops the rollout. Fix forward or roll back that batch; do not
   proceed with a known failure "to be fixed after."

For a critical security fix, compress the timeline but keep the shape. Even then,
one app first.

---

## When something breaks at 2am

1. `fleet-status.sh` — is it one app, one host, or everything? That answer changes
   what you do next more than any other fact. It is one `/api/health` call per app,
   so it works even when nothing else does.
2. **Everything on one host down** → the ingress or the host. `OPERATE.md` §6.
3. **One app down** → its logs. `docker logs <app>-backend --tail 100`.
4. **Everything everywhere down** → `EMERGENCY.md`.
5. Whatever you do, write it in that app's `docs/LOG.md` before you go back to bed.
   You will not remember it, and the next incident on that app starts by reading it.

---

## What limits the fleet

Being honest about the ceilings, so they are hit deliberately rather than by surprise:

| Limit | Where it bites | What you do about it |
|---|---|---|
| **NAS RAM** | ~10–15 apps, one Postgres container each | Client apps were always going to the cloud (ADR-026). The NAS holds internal tools and staging only. |
| **Cost per cloud instance** | Somewhere in the tens of clients, if pricing did not account for it | Q-04 in `DECISIONS.md`. Solve it in pricing, not by sharing databases. |
| **Platform release risk** | Immediately — a bad release can break everything | Staged rollout, above. Never negotiable. |
| **Human attention** | Around the point where more than a few apps are Active at once | The Steady state is the mechanism. Protect it. |
| **Domain knowledge** | `DOMAIN-INDIA.md` is one person's head | The fill-in checklist in that file. It is the highest-value hour in the system and it is still not done. |

The first three are engineering problems with known answers. **The last two are the
ones that actually end companies**, and neither is solved by a document — only by
deciding to spend the time.
