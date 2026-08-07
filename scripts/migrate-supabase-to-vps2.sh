#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Migrate CanQuest database: Supabase → Postgres on VPS 2 (localhost:5432)
#
# STRATEGY: pg_dump (full: schema + data + _prisma_migrations) dari Supabase
# direct connection (port 5432, BUKAN pooler 6543) → restore ke DB target VPS 2.
#
# Safe by default:
#   - Requires confirmation unless --yes
#   - --dry-run validates everything but does NOT touch the target DB
#   - Refuses to overwrite a target DB that already has data (use --force)
#   - Keeps a timestamped dump file on disk for rollback
#
# PREREQUISITES (run on VPS 2):
#   - Postgres client tools:  sudo apt install -y postgresql-client
#   - Target DB running:      docker compose up -d   (from repo root)
#   - apps/api/.env has DIRECT_URL (VPS 2 target) set, OR pass --target-url
#
# USAGE (run on VPS 2, repo root):
#   bash scripts/migrate-supabase-to-vps2.sh \
#     --source-url "postgresql://postgres:[PW]@db.[PROJ].supabase.co:5432/postgres" \
#     --target-url "postgresql://canquest:[PW]@localhost:5432/canquest_app"
#
#   DRY RUN (no writes):
#     ... --dry-run
#
# Read apps/api/.env automatically if --source-url / --target-url omitted:
#   - SOURCE: reads SUPABASE_DIRECT_URL (you must add it to .env for migration)
#   - TARGET: reads DIRECT_URL
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_ENV="$REPO_ROOT/apps/api/.env"

SOURCE_URL=""
TARGET_URL=""
DRY_RUN=false
FORCE=false
ASSUME_YES=false
DUMP_DIR="$REPO_ROOT/.migration-dumps"

usage() {
  sed -n '2,/^# ──*$/p' "$0" | sed 's/^# \?//' | sed 's/^#─*$/──────────/'
  exit 1
}

while [ $# -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --source-url=*)  SOURCE_URL="${arg#*=}" ;;
    --source-url)    shift; SOURCE_URL="$1" ;;
    --target-url=*)  TARGET_URL="${arg#*=}" ;;
    --target-url)    shift; TARGET_URL="$1" ;;
    --dry-run)       DRY_RUN=true ;;
    --force)         FORCE=true ;;
    --yes|-y)        ASSUME_YES=true ;;
    -h|--help)       usage ;;
    *) echo "Unknown arg: $arg"; usage ;;
  esac
  shift
done

# ── Load apps/api/.env for fallback URLs ─────────────────────────────────────
load_env() {
  local f="$1"; [ -f "$f" ] || return 0
  while IFS='=' read -r k v; do
    k="${k%%#*}"; k="$(echo "$k" | xargs)"
    [ -z "$k" ] && continue
    case "$k " in
      "SUPABASE_DIRECT_URL ") [ -z "$SOURCE_URL" ] && SOURCE_URL="$v" ;;
      "DIRECT_URL ")          [ -z "$TARGET_URL" ] && TARGET_URL="$v" ;;
    esac
  done < "$f"
}
load_env "$API_ENV"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

echo "━━━ CanQuest DB migration: Supabase → VPS 2 Postgres ━━━"
if $DRY_RUN; then yellow "DRY RUN — no writes to target DB"; fi

# ── Validate inputs ──────────────────────────────────────────────────────────
err=0
[ -z "$SOURCE_URL" ] && { red "ERROR: --source-url missing (or set SUPABASE_DIRECT_URL in apps/api/.env)"; err=1; }
[ -z "$TARGET_URL" ] && { red "ERROR: --target-url missing (or set DIRECT_URL in apps/api/.env)"; err=1; }
[ "$SOURCE_URL" = "$TARGET_URL" ] && { red "ERROR: source and target URLs are identical — refusing"; err=1; }
case "$SOURCE_URL" in
  *supabase.co*) : ;;  # expected
  *) yellow "WARN: source URL does not contain 'supabase.co' — continuing anyway";;
esac
case "$SOURCE_URL" in
  *":6543"*) red "ERROR: source URL uses pooler port 6543. Use DIRECT connection port 5432 from Supabase dashboard (Settings → Database → Connection string → URI)."; err=1;;
esac
case "$TARGET_URL" in
  *"@localhost"*|*"@127.0.0.1"*) : ;;
  *) yellow "WARN: target URL is not localhost — make sure this is the VPS 2 Postgres you intend to write to";;
esac
[ $err -eq 1 ] && exit 1

# ── Check tools ──────────────────────────────────────────────────────────────
for cmd in pg_dump psql; do
  command -v "$cmd" >/dev/null 2>&1 || { red "ERROR: '$cmd' not found. Install: sudo apt install -y postgresql-client"; exit 1; }
done

mask() { sed -E 's#(://[^:]+:)[^@]+@#\1****@#g'; }
echo ""
bold "Source (Supabase):"; echo "  $(echo "$SOURCE_URL" | mask)"
bold "Target (VPS 2):";    echo "  $(echo "$TARGET_URL" | mask)"
echo ""

# ── Test connectivity ────────────────────────────────────────────────────────
echo "→ Testing source connectivity (Supabase)..."
if ! psql "$SOURCE_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  red "ERROR: cannot connect to SOURCE. Check URL / IP allowlist in Supabase (Settings → Database → Network restrictions)."
  exit 1
fi
green "  ✓ Source reachable"

echo "→ Testing target connectivity (VPS 2 Postgres)..."
if ! psql "$TARGET_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  red "ERROR: cannot connect to TARGET. Is Postgres up? Run: docker compose up -d"
  exit 1
fi
green "  ✓ Target reachable"

# ── Source row counts (for post-restore comparison) ──────────────────────────
echo "→ Counting key tables in source..."
count_table() { psql "$1" -tAc "SELECT count(*) FROM \"$2\";" 2>/dev/null || echo "N/A"; }
SRC_USER=$(count_table "$SOURCE_URL" "User")
SRC_QUEST=$(count_table "$SOURCE_URL" "Quest")
SRC_CCTX=$(count_table "$SOURCE_URL" "CcTransaction")
echo "  User=${SRC_USER}  Quest=${SRC_QUEST}  CcTransaction=${SRC_CCTX}"

# ── Safety: refuse if target already has data ────────────────────────────────
TGT_USER=$(count_table "$TARGET_URL" "User")
if [ "$TGT_USER" != "N/A" ] && [ "$TGT_USER" -gt 0 ] 2>/dev/null; then
  if ! $FORCE; then
    red "ERROR: target DB already has ${TGT_USER} rows in \"User\"."
    echo "  To overwrite (DESTROYS current target data): re-run with --force"
    exit 1
  fi
  yellow "  --force: target has ${TGT_USER} User rows — will DROP/RECREATE schema before restore"
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
if ! $ASSUME_YES && ! $DRY_RUN; then
  echo ""
  yellow "About to dump from Supabase and RESTORE into VPS 2 Postgres."
  if $FORCE; then yellow "Target data will be OVERWRITTEN (--force)."; fi
  read -rp "Proceed? [y/N] " yn
  case "$yn" in y|Y|yes) ;; *) echo "Aborted."; exit 1 ;; esac
fi

if $DRY_RUN; then
  echo ""
  green "DRY RUN OK — all checks passed. Re-run without --dry-run to perform the migration."
  exit 0
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
mkdir -p "$DUMP_DIR"
TS=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$DUMP_DIR/supabase_${TS}.dump"

echo ""
echo "→ Dumping Supabase → $DUMP_FILE"
# --no-owner / --no-privileges: avoid role mismatch (supabase roles ≠ local roles).
# Include _prisma_migrations so prisma migrate deploy knows the state.
pg_dump "$SOURCE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --no-comments \
  --file="$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
green "  ✓ Dump saved (${DUMP_SIZE})"

# ── Restore ──────────────────────────────────────────────────────────────────
echo ""
echo "→ Preparing target (drop & recreate schema, clean state)..."
# Drop public schema cascade → recreate, so restore lands on an empty DB.
psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS _prisma_migrations CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
SQL

echo "→ Restoring dump into VPS 2 Postgres..."
# --clean disabled (we already dropped schema). --if-exists + --no-owner avoid role errors.
pg_restore --dbname="$TARGET_URL" \
  --no-owner --no-privileges \
  --no-comments \
  --if-exists \
  --exit-on-error \
  "$DUMP_FILE"
green "  ✓ Restore complete"

# ── Verify ───────────────────────────────────────────────────────────────────
echo ""
echo "→ Verifying row counts in target..."
TGT_USER_AFTER=$(count_table "$TARGET_URL" "User")
TGT_QUEST_AFTER=$(count_table "$TARGET_URL" "Quest")
TGT_CCTX_AFTER=$(count_table "$TARGET_URL" "CcTransaction")
echo "  User=${TGT_USER_AFTER}  Quest=${TGT_QUEST_AFTER}  CcTransaction=${TGT_CCTX_AFTER}"

ok=true
for pair in "User:${SRC_USER}:${TGT_USER_AFTER}" "Quest:${SRC_QUEST}:${TGT_QUEST_AFTER}" "CcTransaction:${SRC_CCTX}:${TGT_CCTX_AFTER}"; do
  tbl="${pair%%:*}"; rest="${pair#*:}"; s="${rest%%:*}"; t="${rest#*:}"
  if [ "$s" = "$t" ]; then green "  ✓ $tbl match ($s)"
  else red "  ✗ $tbl MISMATCH: source=$s target=$t"; ok=false; fi
done

# Verify _prisma_migrations restored (so future migrate deploy is consistent)
MIG_COUNT=$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM \"_prisma_migrations\";" 2>/dev/null || echo 0)
echo "  _prisma_migrations rows: ${MIG_COUNT}"

echo ""
if $ok; then
  green "━━━ Migration succeeded ━━━"
  echo "  Dump kept at: $DUMP_FILE"
  echo ""
  bold "Next steps (see docs/MIGRATION_SUPABASE_TO_VPS2.md):"
  echo "  1. Edit apps/api/.env → DATABASE_URL + DIRECT_URL = localhost:5432 target"
  echo "  2. pm2 restart canquest-api --update-env"
  echo "  3. curl http://localhost:3001/api/health  &&  test login"
  echo "  4. After stable, pause/delete Supabase project"
else
  red "━━━ Verification FAILED — row counts differ ━━━"
  echo "  Target data may be incomplete. Inspect with psql, or restore the dump"
  echo "  to a scratch DB to compare. Dump kept at: $DUMP_FILE"
  exit 2
fi
