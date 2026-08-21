# Biztrack

@.ai-eos/AGENTS.md

Company rules imported above are law. Below is only what is true of **this app**.

## This app

- **Does:** CRM, tasks, org tree and Herbalife inventory + invoicing for one owner.
- **Client:** internal · **Target:** aws `ap-south-1` · **Exposure:** authenticated
- **Serverless, not Docker/Postgres/Python.** That deviation from `BUILD.md` §1 is
  deliberate and permanent — `docs/PROJECT.md` §8 before you "fix" it.

## Law for this app

- Secrets: load the `aws-secrets-manager` skill first. Never call
  `get-secret-value`; use `{{resolve:secretsmanager:...}}` with `asm-exec`.
- Infrastructure changes go through CDK in `infra/`. Never the console.
- No em dashes in AWS resource names or descriptions.

## Before you touch this app

`docs/PROJECT.md` first; continuing prior work, `docs/LOG.md` bottom-up. App rules
are `docs/RULES.md`. Open items are `docs/followups/README.md`.

Done means `./verify.sh` passes and `docs/LOG.md` has an entry. Not before.
