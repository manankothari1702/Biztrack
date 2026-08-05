# Fleet scripts

Seven scripts. Each replaces work that does not survive being done a hundred times.
Written in bash, run from any machine with Docker access to the fleet.

| Script | Replaces | Priority |
|---|---|---|
| `new-app.sh <name> "<title>" --target=nas\|aws` | ~18 manual setup steps per app | **build first** |
| `fleet-status.sh` | The five hand-maintained registers | **build first** |
| `fleet-verify.sh` | Manually checking apps still work | build second |
| `fleet-audit.sh` | Manually running npm/pip audit per repo | build second |
| `fleet-patch.sh <version> [--apps=...]` | Applying a security fix by hand ×100, **and re-vendoring `.ai-eos/` + `verify.sh` above the APP CHECKS marker** | build third |
| `fleet-access-review.sh` | Opening every app's admin page quarterly | build third |
| `new-host.sh <client>` | Hand-provisioning a cloud instance | build with the first cloud client |

## `new-app.sh` — what it must do

This is the highest-value script in the system. Everything it does is a step a human
would otherwise repeat a hundred times, and each repetition is a chance to skip one.

1. Create the project folder from `templates/new-project/`, and vendor the standard
   into `.ai-eos/` at the pinned version.
2. Substitute the app name everywhere (`<APP>` placeholders in compose, nginx, docs).
3. `git init`, first commit, `.gitignore` with `.env` already in it.
4. Generate `.env` from `.env.example` with fresh random secrets, print them once for
   the password manager, never log them.
5. Set the ingress labels for the chosen hostname.
6. Pin the current `PLATFORM_VERSION`.
7. Write `docs/PROJECT.md` header with the app name, client, target and creation date.
8. Make `verify.sh` executable and install the hook: `git config core.hooksPath .githooks`.
9. Print the three next steps and nothing else.

Step 8 is what turns the gate into a habit. A check that runs only when someone
remembers is a check that runs about sixty percent of the time, and you cannot tell
which sixty.

**It must not** allocate a port, create a proxy rule, request a certificate or update
a register. Those are the four things ADR-022 and ADR-028 deleted.

## Budget check

`fleet-status.sh` also asserts the context budgets, because they are the one thing
that degrades invisibly:

```bash
[ "$(wc -c < AGENTS.md)" -le 3400 ] || echo "company AGENTS.md over budget"
[ "$(wc -c < "$app/AGENTS.md")" -le 1100 ] || echo "$app AGENTS.md over budget"
```

A character budget rather than a token count, so it is checkable anywhere without a
tokeniser and means the same thing to everyone.

## Conventions for all seven

- Read-only by default. Anything that changes state needs an explicit flag.
- Report exceptions, not status. A hundred green lines is a report nobody reads.
- Exit non-zero on any failure, so CI and cron can use them unmodified.
- Never print a secret. Never write one to a log.
- Idempotent where possible — running twice should be safe.
