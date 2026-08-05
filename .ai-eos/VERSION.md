# VERSIONS

**The only place any version number lives.** If you find a version history in another
file, it is a bug — delete it and point here.

Two numbers move independently:

| | What it versions | Changes when | Where an app records it |
|---|---|---|---|
| **AI-EOS** | The standard — rules, layout, docs, `verify.sh` | A rule changes | `docs/PROJECT.md` § Identity |
| **Platform** | The shared code — ingress, auth, backup, ui-kit | Code ships | `.env` → `PLATFORM_VERSION`, reported at `/api/health` |

They are separate because a documentation change must not force a hundred container
rebuilds, and a security patch in the backup image must not wait for a standards
review.

---

## Current

| | Version | Released |
|---|---|---|
| **AI-EOS** | **3.4** | 2026-08 |
| **Platform** | **1.0.0** | not yet released — see `platform/PLATFORM.md` § Build order |

---

## AI-EOS history

### 3.4 — 2026-08 · Not breaking

The prompts become part of the operating system. You never paste more than one line
again.

- **`commands/new-project.md` and `commands/adopt-project.md`** — the only two
  prompts, version-controlled with the standard they enforce. Review is not a third:
  it is already seven agent files, and a command pointing at them would be indirection
  with no content.
- **A read-everything instruction was corrected.** Both commands now say read
  `AGENTS.md` and follow its routing — loading the whole system up front costs tens of
  thousands of tokens per session and defeats the architecture that makes it cheap.
- **New-project now scaffolds by script before designing**, and stops after design.
  A hand-built folder structure diverges immediately and fights every later patch.
- **Rule of Three** added to `BUILD.md` §8 — never abstract after one use.
- `MIGRATION.md` keeps the reasoning; the prompt moved to the command. **Document
  explains, command instructs, script enforces** — if something is in two, one is wrong.

**To move an app from 3.3 → 3.4:** re-vendor `.ai-eos/`. Nothing in the app changes.

### 3.3 — 2026-08 · Not breaking

Adoption of existing projects becomes a first-class workflow, distinct from creating
a new one.

- **`MIGRATION.md`** — how to adopt AI-EOS into a project that already works. Five
  phases ordered by reversibility, a hard stop before anything is changed, an explicit
  "should this app adopt at all?" test, and a paste-ready prompt.
- **Three workflows named and separated** — New, Adopt, Review. They differ in their
  default answer to *"should I change this code?"*: yes / no-unless-approved / never.
- **The standard is vendored per project as `.ai-eos/`**, version-pinned, read-only.
  `AGENTS.md` stays at the repository root and imports it — putting the only copy
  inside `.ai-eos/` would disable auto-load and undo ADR-027.
- **`verify.sh` gained two checks:** the vendored standard is present, and the root
  `AGENTS.md` imports it.
- `fleet-patch.sh` now also re-vendors `.ai-eos/` and the standard half of `verify.sh`.

**To move an app from 3.2 → 3.3:** vendor `.ai-eos/`, confirm the root `AGENTS.md`
imports it, copy the current `verify.sh`.

### 3.2 — 2026-08 · Not breaking

Three mechanisms, no new documents. All three exist to make the system hold its shape
under pressure rather than to add capability.

- **`AGENTS.md` now has an amendment rule**, in `BUILD.md` §12 — deliberately in a
  file nobody loads at runtime, so protecting the budget does not consume it. Two
  tests for whether a rule belongs, and the standing instruction that when the budget
  is hit, **something leaves**; the budget does not move.
- **The gate is now a habit.** The scaffold installs `.githooks/pre-commit` running
  `verify.sh --fast`, so it runs without anyone deciding to.
- **The ratchet.** Any review finding a script could have caught becomes a new
  `verify.sh` check rather than a one-off fix (`review/SHARED_RULES.md`). This is the
  mechanism that makes the expensive review layer shrink over time, and the cheapest
  way to free space in `AGENTS.md` — a rule a script enforces need not sit in the
  context window.

**To move an app from 3.1 → 3.2:** copy `verify.sh` and `.githooks/` from
`templates/new-project/`, then `git config core.hooksPath .githooks`.

### 3.1 — 2026-08 · Not breaking

Additive and clarifying. Any app on 3.0 is compliant with 3.1 without changes,
except that `verify.sh` gained checks it will now fail on.

- **`/api/health` is now the fleet contract.** It absorbs `/api/version`; response
  fields are machine-readable, and detail is auth-gated. `platform/PLATFORM.md`.
- **Five platform contracts made explicit** — Health, Auth, Error, Logging, Backup.
  Previously implied.
- **`verify.sh` tiered** into `--fast` (seconds, every save) and full (pre-deploy),
  with lint, type check, migration, env-completeness, security-header and
  production-build checks added.
- **This file.** Version histories removed from `BUILD.md` and `PLATFORM.md`.
- **Standing rejection list** added to `DECISIONS.md`.

**To move an app from 3.0 → 3.1:** copy the current `verify.sh` from
`templates/new-project/`, run it, fix what it reports. Nothing else.

### 3.0 — 2026-08-03 · **Breaking** for apps built to the old v2.x standard

Rewritten for a fleet of client-facing deployments rather than six internal tools.

| Removed | Replaced by |
|---|---|
| Port allocation and the port register | Label-routed ingress (ADR-022) |
| Twelve manual quality gates | `verify.sh` (ADR-025) |
| Per-app `dashboard-spec.md` | One shared ui-kit (ADR-030) |
| Duplicated backup module | Shared backup image (ADR-023) |
| Four docs per app + the Sync Rule | Three docs, one mandatory per change (ADR-024) |
| The pasted AI context block | Auto-loaded `AGENTS.md` (ADR-027) |
| Hand-maintained registers | Generated `fleet/REGISTRY.md` (ADR-028) |
| Admin and team manuals | `SECURITY.md` §3 (ADR-029) |
| Numbered filenames | Named files |

| Added | Why |
|---|---|
| `BUILD.md` §10 testing | There was none, and an untested fleet cannot be patched |
| `BUILD.md` §3 migrations | 100 client databases with no migration discipline is how data is lost |
| `platform/` | 100 copies of anything cannot be maintained |
| `fleet/` | The entire difference between 6 apps and 100 |

**Migrating a v2.x app:** don't, unless you are already working on it.
`BUILD.md` §11. A live documented app on an old version beats a half-migrated one
with two days of unrelated risk attached.

### 2.x and earlier

The `@CORE DOCUMENTS/` system: eleven numbered files for one practice running six
internal apps on one NAS. Correct for that. Superseded by 3.0 — the reasoning is in
`standards/DECISIONS.md` ADR-021.

---

## Platform history

Semantic versioning. Apps pin a version and upgrade on their own schedule.

| Version | Date | Change | Apps must |
|---|---|---|---|
| 1.0.0 | *unreleased* | ingress · backup · auth · ui-kit, first release | — |

| Bump | Means | Rollout |
|---|---|---|
| **patch** | bug or security fix | `fleet-patch.sh`, staged: 1 app → 5 → the rest. Each gated by its own `verify.sh`. |
| **minor** | new capability, backwards-compatible | Adopt at the next substantial work on that app |
| **major** | breaking | Written migration path + deprecation date. Old major keeps working one full financial year (`BUILD.md` §6). |

> **A breaking platform release is the most dangerous single event in this system** —
> it can break a hundred apps at once. Never skip the staged rollout, and never
> compress it below one app first, not even for a critical fix.

---

## Answering "what is app #92 on, and what does it need?"

```bash
curl -s https://<app>/api/health | jq '{eos: .standard, platform: .platform}'
```

Then read the history above between that version and current. **Most rows will not
apply to that app** — that is normal, and it is why each entry states what an app
must actually do rather than only what changed.

`fleet/scripts/fleet-status.sh` does this across every app at once and reports only
the ones behind.
