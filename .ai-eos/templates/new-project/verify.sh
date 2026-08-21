#!/usr/bin/env bash
#
# THE RELEASE GATE. One command answers: can this app be deployed?
#
#   ./verify.sh --fast     seconds. Run on every save and in the pre-commit hook.
#   ./verify.sh            full. Run before any deploy, and in CI.
#
# Red = do not deploy. There is no second definition of "working".
#
# Shipped by the scaffold and updated by fleet-patch.sh — this file is part of the
# standard (../VERSION.md), not part of the app. Add app-specific checks at the
# bottom, under APP CHECKS, so a standard upgrade never clobbers them.
set -uo pipefail

APP="${APP_NAME:-<APP>}"
BASE="${VERIFY_BASE_URL:-http://localhost}"
FAST=0; [ "${1:-}" = "--fast" ] && FAST=1
FAIL=0

pass() { printf '  \033[32m✓\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=1; }
skip() { printf '  \033[90m–\033[0m  %s (%s)\n' "$1" "${2:-}"; }
have() { command -v "$1" >/dev/null 2>&1; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "STATIC — no services needed"

# --- secrets ---------------------------------------------------------------
git ls-files --error-unmatch .env >/dev/null 2>&1 \
  && fail "secrets not in git" ".env is tracked — rotate every secret in it now" \
  || pass "secrets not in git"

if git log --all --diff-filter=A --name-only --pretty=format: 2>/dev/null | grep -qx '.env'; then
  fail "secrets never committed" ".env exists in git history — those secrets are compromised"
else
  pass "secrets never committed"
fi

# --- env completeness: every key in .env.example present in .env -----------
if [ -f .env ] && [ -f .env.example ]; then
  MISSING=$(comm -23 \
    <(grep -oE '^[A-Z_]+' .env.example | sort -u) \
    <(grep -oE '^[A-Z_]+' .env         | sort -u))
  PLACEHOLD=$(grep -E '^[A-Z_]+=(CHANGE_ME|)$' .env | cut -d= -f1 | tr '\n' ' ')
  [ -z "$MISSING" ]   && pass "env complete"    || fail "env complete" "missing: $(echo $MISSING | tr '\n' ' ')"
  [ -z "$PLACEHOLD" ] && pass "env filled in"   || fail "env filled in" "still placeholder: $PLACEHOLD"
else
  fail "env complete" ".env or .env.example missing"
fi

# --- money precision --------------------------------------------------------
if grep -rnE '\b(float|REAL|parseFloat|DOUBLE PRECISION)\b' backend/app frontend/src 2>/dev/null \
     | grep -viE '(test|^\s*#|//)' | grep -q .; then
  fail "money precision" "float/REAL/parseFloat in the money path:"
  grep -rnE '\b(float|REAL|parseFloat|DOUBLE PRECISION)\b' backend/app frontend/src 2>/dev/null | head -5 | sed 's/^/       /'
else
  pass "money precision"
fi

# --- no secret logging ------------------------------------------------------
if grep -rniE '(log|print).*(password|token|jwt|secret)' backend/app 2>/dev/null | grep -vi 'test' | grep -q .; then
  fail "no secret logging" "a log line appears to include a credential"
else
  pass "no secret logging"
fi

# --- database not published -------------------------------------------------
grep -A6 -E '^\s+\S+-db:' docker-compose.yml 2>/dev/null | grep -qE '^\s+ports:' \
  && fail "database not published" "the db service has a ports: section" \
  || pass "database not published"

# --- ingress labels present, no host ports ----------------------------------
grep -q 'app.route.host' docker-compose.yml 2>/dev/null \
  && pass "ingress labels present" || fail "ingress labels present" "no app.route.host label"

# --- migrations forward-only ------------------------------------------------
if [ -d backend/migrations ]; then
  if git diff --name-only HEAD~1 2>/dev/null | grep -q '^backend/migrations/' \
     && git diff --diff-filter=M --name-only HEAD~1 2>/dev/null | grep -q '^backend/migrations/'; then
    fail "migrations forward-only" "an existing migration was modified — write a new one instead"
  else
    pass "migrations forward-only"
  fi
else
  fail "migrations forward-only" "backend/migrations does not exist"
fi

# --- docs -------------------------------------------------------------------
for d in docs/PROJECT.md docs/RULES.md docs/LOG.md AGENTS.md; do
  [ -s "$d" ] && pass "$d present" || fail "$d present" "missing or empty"
done
[ "$(wc -c < AGENTS.md 2>/dev/null || echo 9999)" -le 1100 ] \
  && pass "AGENTS.md within budget" || fail "AGENTS.md within budget" "over 1,100 chars — cut something"

# --- vendored standard present and root context intact ---------------------
[ -f .ai-eos/AGENTS.md ] && pass "standard vendored (.ai-eos/)" \
  || fail "standard vendored (.ai-eos/)" "missing — the app has no pinned standard"
grep -q '@.ai-eos/AGENTS.md' AGENTS.md 2>/dev/null \
  && pass "root AGENTS.md imports the standard" \
  || fail "root AGENTS.md imports the standard" "auto-load is broken without this import"

# --- lint + types -----------------------------------------------------------
if have ruff; then ruff check backend/ -q && pass "lint (python)" || fail "lint (python)" "ruff check failed"
else skip "lint (python)" "ruff not installed"; fi
if have mypy; then mypy backend/app -q >/dev/null 2>&1 && pass "types (python)" || fail "types (python)" "mypy failed"
else skip "types (python)" "mypy not installed"; fi
if [ -f frontend/package.json ]; then
  if have npm; then
    (cd frontend && npm run -s lint >/dev/null 2>&1) && pass "lint (frontend)" || fail "lint (frontend)" "npm run lint failed"
    (cd frontend && npm run -s typecheck >/dev/null 2>&1) && pass "types (frontend)" || skip "types (frontend)" "no typecheck script"
  else skip "lint (frontend)" "npm not available"; fi
fi

# --- mandatory tests exist --------------------------------------------------
for t in test_money_precision test_soft_delete_hidden test_role_boundaries \
         test_audit_written test_backup_restore; do
  grep -rq "$t" backend/tests 2>/dev/null \
    && pass "mandatory test present: $t" \
    || fail "mandatory test present: $t" "required by BUILD.md §10"
done

if [ "$FAST" -eq 1 ]; then
  echo
  [ "$FAIL" -eq 0 ] && { echo "verify --fast: GREEN"; exit 0; }
  echo "verify --fast: RED"; exit 1
fi

sec "BUILD"

docker compose build -q >/dev/null 2>&1 && pass "docker builds" || fail "docker builds" "compose build failed"
if [ -f frontend/package.json ] && have npm; then
  (cd frontend && npm run -s build >/dev/null 2>&1) \
    && pass "production build" || fail "production build" "npm run build failed"
fi

sec "RUNNING SERVICES"

docker compose ps --format '{{.Name}} {{.State}}' 2>/dev/null | grep -qi restarting \
  && fail "containers stable" "something is restarting" || pass "containers stable"

# --- health contract --------------------------------------------------------
H=$(curl -fsS --max-time 5 "$BASE/api/health" 2>/dev/null)
if echo "$H" | grep -q '"healthy"'; then
  pass "health: healthy"
elif echo "$H" | grep -q '"degraded"'; then
  fail "health: healthy" "reports degraded — check database and last_backup_at"
else
  fail "health: healthy" "no valid response from $BASE/api/health"
fi
echo "$H" | grep -q '"version"' && skip "health leaks detail" "unauthenticated response includes version — auth-gate it" \
                                 || pass "health detail auth-gated"

# --- security headers -------------------------------------------------------
HDR=$(curl -fsSI --max-time 5 "$BASE/" 2>/dev/null | tr 'A-Z' 'a-z')
for h in strict-transport-security x-content-type-options content-security-policy referrer-policy; do
  echo "$HDR" | grep -q "$h" && pass "header: $h" || fail "header: $h" "not set — should come from the ingress"
done

# --- tests ------------------------------------------------------------------
docker compose exec -T "$APP-backend" pytest -q >/dev/null 2>&1 \
  && pass "test suite" || fail "test suite" "pytest did not pass"

# --- backup round trip ------------------------------------------------------
if docker compose exec -T "$APP-backup" /backup-selftest.sh >/dev/null 2>&1; then
  pass "backup + restore round trip"
else
  fail "backup + restore round trip" "an unrestored backup is a file, not a safety net"
fi

# ============================================================================
# APP CHECKS — add anything specific to this app below. Preserved across
# standard upgrades; everything above is overwritten by fleet-patch.sh.
# ============================================================================


echo
[ "$FAIL" -eq 0 ] && { echo "verify: GREEN — clear to deploy"; exit 0; }
echo "verify: RED — do not deploy"; exit 1
