# <APP_TITLE>

@.ai-eos/AGENTS.md

Company rules imported above are law. Below is only what is true of **this app**.

## This app

- **Does:** <one sentence a non-technical person understands>
- **Client:** <name, or "internal">
- **Target:** <nas | aws> · **Exposure:** <public | authenticated | vpn only>

## Role scope

| Role | May do |
|---|---|
| `admin` | everything, including backup and restore |
| `manager` | <decide at design time> |
| `user` | <decide at design time> |
| `readonly` | <decide at design time> |

## Before you touch this app

Read `docs/PROJECT.md`; if continuing prior work, `docs/LOG.md` bottom-up. Rules this
app owns are in `docs/RULES.md` — cite the rule ID in any function implementing one.

Done means `./verify.sh` passes and `docs/LOG.md` has an entry. Not before.

<!-- Keep at repo root: every AI tool auto-loads from there. Budget: wc -c < 1100. -->
