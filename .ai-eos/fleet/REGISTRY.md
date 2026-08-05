# FLEET REGISTRY

> **GENERATED FILE — DO NOT EDIT.**
> Written by `fleet/scripts/fleet-status.sh`. Any hand edit is overwritten on the
> next run, and a register that is edited by hand is a register that is wrong.
>
> **Generated:** _never — run `fleet-status.sh`_
> If that timestamp is more than a week old, the generator is broken. Fix that first;
> everything below is stale until you do.

---

Every column below except disk and cert expiry comes from one `GET /api/health` call
per app. That is the whole reason the health contract is mandatory.

## Applications

| App | Client | State | Host | URL | Version | Platform | Standard | Health | DB | Restarts | Last backup |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _(populated by fleet-status.sh)_ | | | | | | | | |

## Hosts

| Host | Target | Apps | Disk free | RAM free | Cert expiry |
|---|---|---|---|---|---|
| _(populated)_ | | | | | |

## Attention needed

| App | Issue | Since |
|---|---|---|
| _(only exceptions appear here — an empty table is the goal)_ | | |

---

**What is deliberately not here:** open items, plans, and reasons. Those live as
issues in each project's repository, where the person doing the work will see them.
A register mixing facts with intentions goes stale in both directions at once —
see `standards/DECISIONS.md` ADR-028.
