#!/usr/bin/env bash
# Restores the latest backup into a throwaway database and verifies it.
# Exit code is non-zero on any failure.
#
# Full mode (needs the age PRIVATE key, so run it where the owner holds it):
#   checks every expected table exists and that transactions >= baseline.
#   Baseline = max of EXPECTED_MIN_TX, the backup's .manifest, and the row
#   count in SOURCE_URL (when given). With no baseline at all it fails.
# Shallow mode (explicit --shallow only; the server's weekly cron has no key):
#   checks the latest backup exists, is recent, non-empty and age-encrypted.
#
# Env:
#   BACKUP_DIR | RCLONE_REMOTE   where backups live (as in backup.sh)
#   DECRYPT_CMD | AGE_IDENTITY_FILE   required unless --shallow (age -d -i FILE)
#   RESTORE_ADMIN_URL   admin URL of a scratch Postgres to restore into; when
#                       unset, a postgres:16 docker container is started
#   SOURCE_URL, EXPECTED_MIN_TX, EXPECTED_TABLES (space-separated override)
#   PSQL, RCLONE, MAX_AGE_HOURS (shallow, default 36)
#   --shallow           force shallow mode
set -euo pipefail

PSQL=${PSQL:-psql}
RCLONE=${RCLONE:-rclone}
MAX_AGE_HOURS=${MAX_AGE_HOURS:-36}
DEFAULT_TABLES="accounts transactions rules expected_incomes income_events scheduled_payments manual_balances loans settings bridge_plans daily_snapshots fx_rates jobs devices notifications_log"
EXPECTED_TABLES=${EXPECTED_TABLES:-$DEFAULT_TABLES}

fail() { echo "restore-check FAILED: $*" >&2; exit 1; }

mode=full
[ "${1:-}" = "--shallow" ] && mode=shallow
if [ "$mode" = full ] && [ -z "${DECRYPT_CMD:-}" ]; then
  if [ -n "${AGE_IDENTITY_FILE:-}" ]; then
    DECRYPT_CMD="age -d -i $AGE_IDENTITY_FILE"
  else
    # Never downgrade silently: a forgotten key must not look like success.
    fail "full mode needs AGE_IDENTITY_FILE or DECRYPT_CMD (pass --shallow to only check freshness)"
  fi
fi

work=$(mktemp -d)
cid=""
restore_db=""
cleanup() {
  if [ -n "$restore_db" ] && [ -n "${admin:-}" ]; then
    # shellcheck disable=SC2086
    $PSQL "$admin" -qc "drop database if exists $restore_db" >/dev/null 2>&1 || true
  fi
  [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# --- locate the latest backup ---------------------------------------------
if [ -n "${BACKUP_DIR:-}" ]; then
  # shellcheck disable=SC2012
  latest=$(ls -1 "$BACKUP_DIR"/tablo-*.sql.gz.age 2>/dev/null | sort | tail -1 || true)
  [ -n "$latest" ] || fail "no backups in $BACKUP_DIR"
  cp "$latest" "$work/dump"
  cp "$latest.manifest" "$work/manifest" 2>/dev/null || : > "$work/manifest"
  bname=$(basename "$latest")
else
  : "${RCLONE_REMOTE:?set BACKUP_DIR or RCLONE_REMOTE}"
  # shellcheck disable=SC2086
  bname=$($RCLONE lsf "$RCLONE_REMOTE" --include 'tablo-*.sql.gz.age' | sort | tail -1)
  [ -n "$bname" ] || fail "no backups in $RCLONE_REMOTE"
  # shellcheck disable=SC2086
  $RCLONE copyto "$RCLONE_REMOTE/$bname" "$work/dump"
  # shellcheck disable=SC2086
  $RCLONE copyto "$RCLONE_REMOTE/$bname.manifest" "$work/manifest" 2>/dev/null || : > "$work/manifest"
fi
[ -s "$work/dump" ] || fail "latest backup $bname is empty"

if [ "$mode" = shallow ]; then
  ts=${bname#tablo-}; ts=${ts%%.*}
  then_epoch=$(date -u -j -f %Y%m%dT%H%M%SZ "$ts" +%s 2>/dev/null || date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s)
  age_h=$(( ( $(date -u +%s) - then_epoch ) / 3600 ))
  [ "$age_h" -le "$MAX_AGE_HOURS" ] || fail "latest backup $bname is ${age_h}h old (limit ${MAX_AGE_HOURS}h)"
  if [ -z "${ENCRYPT_CMD:-}" ]; then
    [ "$(head -c 21 "$work/dump")" = "age-encryption.org/v1" ] || fail "$bname is not an age file"
  fi
  echo "restore-check SHALLOW ok: $bname (${age_h}h old). Full restore needs the age private key: run it with AGE_IDENTITY_FILE set."
  exit 0
fi

# --- scratch Postgres --------------------------------------------------------
admin=${RESTORE_ADMIN_URL:-}
if [ -z "$admin" ]; then
  command -v docker >/dev/null || fail "set RESTORE_ADMIN_URL or install docker"
  cid=$(docker run -d --rm -e POSTGRES_PASSWORD=restore -p 127.0.0.1::5432 postgres:16)
  port=$(docker port "$cid" 5432/tcp | head -1 | sed 's/.*://')
  admin="postgres://postgres:restore@127.0.0.1:$port/postgres"
  for _ in $(seq 1 60); do
    # shellcheck disable=SC2086
    $PSQL "$admin" -qc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
fi
restore_db="restore_check_$$_$(date +%s)"
# shellcheck disable=SC2086
$PSQL "$admin" -qc "create database $restore_db" || fail "cannot create scratch database"
rurl=$(printf '%s' "$admin" | sed -E "s#/[^/?]*(\?|\$)#/$restore_db\1#")

# --- restore -----------------------------------------------------------------
bash -c "$DECRYPT_CMD" < "$work/dump" | gunzip | \
  $PSQL "$rurl" -q -v ON_ERROR_STOP=1 -o /dev/null || fail "restore of $bname failed"

# --- verify ------------------------------------------------------------------
# shellcheck disable=SC2086
have=$($PSQL "$rurl" -Atc "select table_name from information_schema.tables where table_schema='public'")
for t in $EXPECTED_TABLES; do
  printf '%s\n' "$have" | grep -qx "$t" || fail "table '$t' missing after restore"
done

# shellcheck disable=SC2086
restored=$($PSQL "$rurl" -Atc "select count(*) from transactions")
baseline=""
consider() { [ -n "$1" ] && { [ -z "$baseline" ] || [ "$1" -gt "$baseline" ]; } && baseline=$1 || true; }
consider "${EXPECTED_MIN_TX:-}"
consider "$(sed -n 's/^transactions=//p' "$work/manifest")"
if [ -n "${SOURCE_URL:-}" ]; then
  # shellcheck disable=SC2086
  consider "$($PSQL "$SOURCE_URL" -Atc "select count(*) from transactions")"
fi
[ -n "$baseline" ] || fail "no baseline for transactions (no manifest, SOURCE_URL or EXPECTED_MIN_TX)"
[ "$restored" -ge "$baseline" ] || fail "restored $restored transactions, expected at least $baseline"

echo "restore-check ok: $bname ($restored transactions >= $baseline, all expected tables present)"
