# Company standard — read before writing any code

Auto-loaded by Claude Code, Codex and Gemini CLI. Hard budget: `wc -c` under 3,400.
Over budget means something here leaves — see `standards/BUILD.md` §12.
Everything here is law; everything else is a pointer.

## Who we are

Two-founder company shipping isolated SaaS apps to Indian businesses. Almost all code
is AI-written. Optimise for five years of maintenance by two people, not for elegance.
One founder is a chartered accountant, not an engineer — plain language.

## Non-negotiable

- Money is `NUMERIC(18,2)`. Never float. Never `parseFloat`. Floats lose paise.
- Soft delete only. `is_deleted = true`. Never `DELETE` a business record.
- Every table carries `id`, `created_at`, `updated_at`, `created_by`, `is_deleted`.
  Every business write writes an `audit_log` row. Every read filters
  `is_deleted = false` — including totals, exports and reports.
- Roles are `admin` / `manager` / `user` / `readonly`, checked server-side. Hiding a
  button is not a permission.
- API on the same origin under `/api/`. Databases publish no host port. Ever.
- Every app has `GET /api/health` and never removes it — it is how 100 apps are
  monitored by one thing. Errors are `{"detail": "..."}`; logs are structured JSON.
  Shapes: `platform/PLATFORM.md`.
- Secrets live in `.env` and the password manager. Never in a `.md`, never in git.
- Financial year is `VARCHAR(7)` e.g. `2025-26`. Never derived in a query.
- Timezone `Asia/Kolkata`. Display formats: `BUILD.md` §7.
- Never state a tax rate, threshold, section or due date as fact. If you cannot cite
  it, write `[OWNER TO CONFIRM]` and stop.

## Use the platform, don't rebuild it

Auth, backup, ingress and the UI kit are shared versioned artefacts under `platform/`.
Pin a version. Never fork, wrap or reimplement one — fix it there instead, so one
change reaches every app.

## Behaviour

- Boring and direct wins. No wrapper around one call, no repository for one table, no
  factory for one implementation, no config option that is never varied.
- Future-proof deployment, config, auth, backups, logging, migrations and folder
  structure. Do not future-proof application code.
- Never guess silently. State the assumption in your reply and in the docs. Offer
  two options with the trade-off rather than picking one quietly.
- Check `standards/DECISIONS.md` before changing architecture — it may be settled, or
  standing-rejected. Overturn it knowingly with a new ADR; never silently re-decide.
- "I don't know" and "this is ambiguous" are correct answers. Guessing is not.

## Definition of done

`./verify.sh` passes and `docs/LOG.md` has an entry. Not before.

## Read only when the task needs it

| Task | Read |
|---|---|
| Writing code | `standards/BUILD.md` |
| Tax, dates, money, matching | `standards/DOMAIN-INDIA.md` |
| Deploying or a broken container | `standards/OPERATE.md` |
| Auth, secrets, exposure | `standards/SECURITY.md` |
| Changing architecture | `standards/DECISIONS.md` |
| A shared service, or any contract shape | `platform/PLATFORM.md` |
| Reviewing finished work | `review/README.md` |
| Starting or adopting a project | `commands/` — two prompts, follow one exactly |

For this app: `docs/PROJECT.md`, then `docs/LOG.md` bottom-up.
Grep the heading, read with offset/limit. Never load a whole standard.
