# LOG — `<APP>`

Append only. Newest at the bottom. **One entry per completed feature** — not per
edit, not per day. Never rewrite a prior entry; if something turned out wrong, write
a new entry saying so.

This is the only document a code change is required to update. That is deliberate —
one document that is always current beats three that are usually not.

---

## [YYYY-MM-DD] — <feature or task>

**Status:** Completed | Partial | Blocked

**What changed and why**
Plain language. Assume the reader has zero memory of this conversation and has never
seen this codebase. Say what the world was like before, and after.

**Files touched**
- `path/to/file.py` — one line on what it now does

**Edge cases handled** — and explicitly, those **not** handled

**Assumptions / open ambiguities**
Anything guessed rather than confirmed. An unflagged assumption is a bug with a
delayed fuse.

**What could break later**
Name the specific files and functions at risk if this changes again.

**Checks**
- [ ] `./verify.sh` green
- [ ] `docs/PROJECT.md` updated if the app's shape, data model or algorithms changed
- [ ] `docs/RULES.md` updated if a business rule was discovered or clarified

---
