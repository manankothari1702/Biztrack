#!/usr/bin/env bash
#
# THE RELEASE GATE. One command answers: can this app be deployed?
#
#   ./verify.sh --fast     seconds. Run on every save and in the pre-commit hook.
#   ./verify.sh            full. Run before any deploy.
#
# Red = do not deploy. There is no second definition of "working".
#
# ─────────────────────────────────────────────────────────────────────────────
# ADAPTED FOR THIS APP. The scaffold version in `.ai-eos/templates/new-project/`
# assumes Docker Compose, PostgreSQL and pytest. Biztrack is serverless AWS
# (S3/CloudFront + API Gateway + Lambda + DynamoDB + Cognito, via CDK), so those
# checks cannot pass and cannot be made to pass — see `docs/PROJECT.md` §8 D-05.
#
# Every standard check that still applies is kept, with the same name and the
# same meaning. Checks that cannot apply print as `–` with the reason, so the
# difference is visible rather than silently dropped. Because this file is
# stack-specific, `fleet-patch.sh` cannot safely overwrite it.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

FAST=0; [ "${1:-}" = "--fast" ] && FAST=1
FAIL=0

pass() { printf '  \033[32m/\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mX\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=1; }
skip() { printf '  \033[90m-\033[0m  %s (%s)\n' "$1" "${2:-}"; }
have() { command -v "$1" >/dev/null 2>&1; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

cd "$(dirname "$0")" || exit 1

sec "STATIC - no services needed"

# --- secrets ---------------------------------------------------------------
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  fail "secrets not in git" ".env is tracked - rotate every secret in it now"
else
  pass "secrets not in git"
fi

if git log --all --diff-filter=A --name-only --pretty=format: 2>/dev/null | grep -qx '.env'; then
  fail "secrets never committed" ".env exists in git history - those secrets are compromised"
else
  pass "secrets never committed"
fi

# --- env completeness: every key in .env.example present in .env -----------
if [ -f .env ] && [ -f .env.example ]; then
  MISSING=$(comm -23 \
    <(grep -oE '^[A-Z_]+' .env.example | sort -u) \
    <(grep -oE '^[A-Z_]+' .env         | sort -u))
  PLACEHOLD=$(grep -E '^[A-Z_]+=(CHANGE_ME|)$' .env | cut -d= -f1 | tr '\n' ' ')
  [ -z "$MISSING" ]   && pass "env complete"  || fail "env complete" "missing: $(echo $MISSING | tr '\n' ' ')"
  [ -z "$PLACEHOLD" ] && pass "env filled in" || fail "env filled in" "still placeholder: $PLACEHOLD"
else
  fail "env complete" ".env or .env.example missing"
fi

# --- money precision --------------------------------------------------------
# BR-020. DynamoDB has no NUMERIC type, so this grep IS the enforcement -
# see docs/PROJECT.md §8 D-07. Test files are excluded; they may name floats.
MONEY_HITS=$(grep -rnE '\b(parseFloat|Number\.parseFloat)\b' \
               --include='*.ts' --include='*.tsx' \
               src lambda/src infra/lib infra/bin 2>/dev/null \
             | grep -vE '\.test\.tsx?:' | grep -vE '^\s*(//|\*)')
if [ -n "$MONEY_HITS" ]; then
  fail "money precision" "parseFloat in the money path:"
  echo "$MONEY_HITS" | head -5 | sed 's/^/       /'
else
  pass "money precision"
fi

# --- no secret logging ------------------------------------------------------
SECRET_LOGS=$(grep -rniE '(console\.(log|error|warn|info)|logger\.[a-z]+)\(.*(password|token|jwt|secret|credential)' \
                --include='*.ts' --include='*.tsx' src lambda/src 2>/dev/null \
              | grep -viE '\.test\.tsx?:')
if [ -n "$SECRET_LOGS" ]; then
  fail "no secret logging" "a log line appears to include a credential"
  echo "$SECRET_LOGS" | head -3 | sed 's/^/       /'
else
  pass "no secret logging"
fi

# --- database not published -------------------------------------------------
skip "database not published" "DynamoDB - IAM-scoped, no host port exists"

# --- ingress labels ---------------------------------------------------------
skip "ingress labels present" "CloudFront + API Gateway, not the shared NAS ingress"

# --- migrations forward-only ------------------------------------------------
skip "migrations forward-only" "DynamoDB single-table, schemaless - no migrations"

# --- docs -------------------------------------------------------------------
for d in docs/PROJECT.md docs/RULES.md docs/LOG.md AGENTS.md; do
  [ -s "$d" ] && pass "$d present" || fail "$d present" "missing or empty"
done
AGENTS_BYTES=$(wc -c < AGENTS.md 2>/dev/null || echo 9999)
[ "$AGENTS_BYTES" -le 1100 ] \
  && pass "AGENTS.md within budget ($AGENTS_BYTES/1100)" \
  || fail "AGENTS.md within budget" "$AGENTS_BYTES bytes - over 1,100, cut something"

# --- vendored standard present and root context intact ---------------------
[ -f .ai-eos/AGENTS.md ] && pass "standard vendored (.ai-eos/)" \
  || fail "standard vendored (.ai-eos/)" "missing - the app has no pinned standard"
grep -q '@.ai-eos/AGENTS.md' AGENTS.md 2>/dev/null \
  && pass "root AGENTS.md imports the standard" \
  || fail "root AGENTS.md imports the standard" "auto-load is broken without this import"

# --- lint + types -----------------------------------------------------------
if have npm; then
  npm run -s lint >/dev/null 2>&1 \
    && pass "lint (frontend)" \
    || fail "lint (frontend)" "npm run lint failed - 15 errors were already present at AI-EOS adoption (2026-08-05); this is a to-do list, not a new regression"
  npx -y tsc -b --noEmit >/dev/null 2>&1 \
    && pass "types (frontend)" || fail "types (frontend)" "tsc failed"
else
  skip "lint (frontend)" "npm not available"
fi

# --- mandatory tests exist --------------------------------------------------
# BUILD.md §10 names these in Python. Mapped to this app's real coverage;
# soft delete and role boundaries have no test because the app has neither -
# docs/PROJECT.md §8 D-01 and D-02 say why, and D-01 is tracked as FU-EOS-1.
grep -rqE 'roundVp|priceForTier' src/shared/utils/pricing.test.ts 2>/dev/null \
  && pass "mandatory test present: money precision" \
  || fail "mandatory test present: money precision" "required by BUILD.md §10"
grep -rq 'audit' lambda/src/lib/stock.test.ts 2>/dev/null \
  && pass "mandatory test present: audit written (stock)" \
  || fail "mandatory test present: audit written (stock)" "required by BUILD.md §10"
skip "mandatory test present: soft delete hidden" "app hard-deletes - PROJECT.md §8 D-01, tracked FU-EOS-1"
skip "mandatory test present: role boundaries" "single-user app, no roles - PROJECT.md §8 D-02"
skip "mandatory test present: backup restore" "DynamoDB PITR - restore never tested, tracked FU-EOS-2"

if [ "$FAST" -eq 1 ]; then
  echo
  [ "$FAIL" -eq 0 ] && { echo "verify --fast: GREEN"; exit 0; }
  echo "verify --fast: RED"; exit 1
fi

sec "BUILD"

skip "docker builds" "no containers in this app"

if have npm; then
  npm run -s build >/dev/null 2>&1 \
    && pass "production build (frontend)" || fail "production build (frontend)" "npm run build failed"
  (cd lambda && npm run -s build >/dev/null 2>&1) \
    && pass "lambda build" || fail "lambda build" "lambda build failed"
fi

sec "TESTS"

if have npx; then
  npx -y vitest run >/dev/null 2>&1 \
    && pass "test suite (frontend)" || fail "test suite (frontend)" "vitest failed"
  (cd lambda && npx -y vitest run >/dev/null 2>&1) \
    && pass "test suite (lambda)" || fail "test suite (lambda)" "lambda vitest failed"
  (cd infra && npx -y jest >/dev/null 2>&1) \
    && pass "test suite (infra)" || fail "test suite (infra)" "infra jest failed"
fi

sec "DEPLOYED STACK"

# Everything below talks to real AWS. Skipped unless an API base URL is given,
# so the gate stays runnable offline and in a fresh clone.
#   VERIFY_API_URL=https://<id>.execute-api.ap-south-1.amazonaws.com/prod ./verify.sh
API="${VERIFY_API_URL:-$(grep -oE '^VITE_API_URL=.+' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')}"
APP_URL="${VERIFY_APP_URL:-$(grep -oE '^VITE_APP_URL=.+' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')}"

if [ -z "$API" ] || [ "$API" = "/api" ]; then
  skip "health: healthy" "no absolute VITE_API_URL - set VERIFY_API_URL to check the deployed stack"
  skip "health detail auth-gated" "health not reachable"
elif ! have curl; then
  skip "health: healthy" "curl not available"
else
  H=$(curl -fsS --max-time 5 "${API%/}/health" 2>/dev/null)
  if echo "$H" | grep -q '"healthy"'; then
    pass "health: healthy"
  elif echo "$H" | grep -q '"degraded"'; then
    fail "health: healthy" "reports degraded - check the database probe"
  else
    fail "health: healthy" "no valid response from ${API%/}/health"
  fi
  echo "$H" | grep -q '"version"' \
    && fail "health detail auth-gated" "unauthenticated response includes version - auth-gate it" \
    || pass "health detail auth-gated"
fi

# --- security headers -------------------------------------------------------
if [ -n "$APP_URL" ] && have curl; then
  HDR=$(curl -fsSI --max-time 5 "$APP_URL" 2>/dev/null | tr 'A-Z' 'a-z')
  for h in strict-transport-security x-content-type-options referrer-policy; do
    echo "$HDR" | grep -q "$h" && pass "header: $h" || fail "header: $h" "not set - should come from the CloudFront response headers policy"
  done
  echo "$HDR" | grep -q "content-security-policy" \
    && pass "header: content-security-policy" \
    || skip "header: content-security-policy" "deliberately report-only first - PROJECT.md, tracked FU-EOS-3"
else
  skip "security headers" "no VITE_APP_URL - set VERIFY_APP_URL to check"
fi

# --- backup -----------------------------------------------------------------
if have aws; then
  PITR=$(aws dynamodb describe-continuous-backups --table-name "${TABLE_NAME:-biztrack}" \
           --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
           --output text 2>/dev/null)
  [ "$PITR" = "ENABLED" ] && pass "backup enabled (PITR)" \
    || fail "backup enabled (PITR)" "point-in-time recovery is not ENABLED on the table"
else
  skip "backup enabled (PITR)" "aws cli not available"
fi
skip "backup + restore round trip" "never tested - an unrestored backup is a file, not a safety net (FU-EOS-2)"

# --- alerting ---------------------------------------------------------------
# The alarms are worthless without a confirmed destination, and an UNCONFIRMED
# SNS email subscription is the worst case of all: it accepts every alarm and
# throws it away, so the console looks configured while nothing is delivered.
# No subscription ships in the CDK stack on purpose (public repo; a `-c` context
# value would be deleted by the next deploy that forgot the flag - FU-EOS-6),
# so this check is what keeps that decision honest.
if have aws; then
  TOPIC_ARN=$(aws sns list-topics \
                --query "Topics[?ends_with(TopicArn, ':biztrack-alerts')].TopicArn | [0]" \
                --output text 2>/dev/null)
  if [ -n "$TOPIC_ARN" ] && [ "$TOPIC_ARN" != "None" ]; then
    CONFIRMED=$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
                  --query "length(Subscriptions[?SubscriptionArn!='PendingConfirmation' && SubscriptionArn!='Deleted'])" \
                  --output text 2>/dev/null)
    if [ "${CONFIRMED:-0}" -gt 0 ] 2>/dev/null; then
      pass "alarms reach a human"
    else
      fail "alarms reach a human" \
           "biztrack-alerts has no CONFIRMED subscriber - every alarm fires into nothing. Run: aws sns subscribe --topic-arn $TOPIC_ARN --protocol email --notification-endpoint <address>, then click the confirmation link"
    fi
  else
    fail "alarms reach a human" "SNS topic biztrack-alerts does not exist - deploy infra/"
  fi
else
  skip "alarms reach a human" "aws cli not available"
fi

# ============================================================================
# APP CHECKS - anything specific to Biztrack goes below.
# ============================================================================

# Vite env-file trap: VITE_API_URL=/api in .env.local is baked into production
# builds and breaks the deployed app. It belongs in .env.development.local.
# See README.md "Local development".
if [ -f .env.local ] && grep -qE '^VITE_API_URL=/' .env.local 2>/dev/null; then
  fail "no relative API URL in .env.local" \
       ".env.local loads in EVERY mode including build - move this to .env.development.local"
else
  pass "no relative API URL in .env.local"
fi

echo
[ "$FAIL" -eq 0 ] && { echo "verify: GREEN - clear to deploy"; exit 0; }
echo "verify: RED - do not deploy"; exit 1
