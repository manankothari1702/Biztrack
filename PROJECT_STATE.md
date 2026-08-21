# Project state — open items

> **Where open items normally live.** This project's canonical tracker is
> [`docs/followups/README.md`](docs/followups/README.md), per `AGENTS.md`. This file
> exists because that one had uncommitted work in progress and was explicitly out of
> scope when the item below had to be recorded. **Migrate these into
> `docs/followups/README.md` and delete this file once that tracker is free**, so the
> project does not end up with two competing lists of open work.

---

## OPEN · `verify.sh` backup-restore gate is blocking all commits repo-wide

`verify.sh`'s backup-restore gate is currently a hard fail blocking **ALL** commits
repo-wide, due to an uncommitted WIP edit converting it from skip to fail. This needs
either **(a)** someone actually running the restore drill and recording a real date in
`docs/PROJECT.md` §10, or **(b)** someone reverting/parking the WIP `verify.sh` change
until the drill is scheduled. Neither is in scope right now — flagging so it doesn't get
silently normalized as "commits need `--no-verify`."

### Detail

At `HEAD` the check was a tolerated skip:

```
skip "mandatory test present: backup restore" "DynamoDB PITR - restore never tested, tracked FU-EOS-2"
```

The uncommitted working-tree edit promotes it to a blocking failure:

```
fail "backup restore drill" "never tested - an unrestored backup is a file, not a safety net (FU-EOS-2)"
```

The pre-commit hook runs `./verify.sh` from the **working tree**, so an in-progress edit
to that file gates every commit in the repo, not only the change being committed. The
gate reads the `Restore last tested on` row in `docs/PROJECT.md` §10, which currently
reads `🔴 NEVER`.

The policy behind the change is sound — an untested restore is not a safety net, and it
is the long-standing FU-EOS-2. The problem is only that it went live as WIP before the
drill it demands was scheduled.

### Why this is recorded rather than fixed

Commit `07c29d1` (documentation only) was committed with `--no-verify` as an explicit,
authorised, recorded exception. Writing a date into §10 without running a restore was
never an option — that would falsify a safety record. Running the drill is real
infrastructure work and was out of scope for that pass.

**The risk this note exists to prevent:** `--no-verify` quietly becoming the normal way
to commit here. Every bypass after this one should reference this item, and this item
should be closed by (a) or (b) rather than by habit.
