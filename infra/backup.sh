#!/usr/bin/env bash
# Daily encrypted logical backup: pg_dump | gzip | age, shipped off the server.
#
# Required env:
#   DATABASE_URL       connection URL of the database to dump
#   AGE_RECIPIENT      age PUBLIC key (the private key never lives on the server)
# Target (one of):
#   BACKUP_DIR         local-target mode: copy into this directory (dev / tests)
#   RCLONE_REMOTE      e.g. "hz:my-bucket/hale"; rclone S3 settings come from
#                      RCLONE_CONFIG_HZ_* env (Hetzner Object Storage)
# Overrides (also the seams used by the tests):
#   PG_DUMP, PSQL, RCLONE   command strings (default: pg_dump, psql, rclone)
#   ENCRYPT_CMD             default: age -r "$AGE_RECIPIENT"
#   RETENTION_DAYS          default 30
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PG_DUMP=${PG_DUMP:-pg_dump}
PSQL=${PSQL:-psql}
RCLONE=${RCLONE:-rclone}
RETENTION_DAYS=${RETENTION_DAYS:-30}
if [ -z "${ENCRYPT_CMD:-}" ]; then
  : "${AGE_RECIPIENT:?AGE_RECIPIENT (age public key) is required when ENCRYPT_CMD is unset}"
  ENCRYPT_CMD="age -r $AGE_RECIPIENT"
fi
if [ -z "${BACKUP_DIR:-}" ]; then
  : "${RCLONE_REMOTE:?set BACKUP_DIR (local) or RCLONE_REMOTE (Object Storage)}"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="hale-$stamp.sql.gz.age"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Row count taken just before the dump; restore-check.sh uses it as the
# baseline ("restored backup must not have fewer transactions").
# shellcheck disable=SC2086
tx=$($PSQL "$DATABASE_URL" -Atc "select count(*) from transactions")
printf 'transactions=%s\ncreated=%s\n' "$tx" "$stamp" > "$work/$name.manifest"

# shellcheck disable=SC2086
$PG_DUMP --no-owner --no-privileges "$DATABASE_URL" | gzip -9 | bash -c "$ENCRYPT_CMD" > "$work/$name"
[ -s "$work/$name" ] || { echo "backup: empty output" >&2; exit 1; }

if [ -n "${BACKUP_DIR:-}" ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$work/$name" "$work/$name.manifest" "$BACKUP_DIR/"
  find "$BACKUP_DIR" -name 'hale-*' -type f -mtime "+$RETENTION_DAYS" -delete
else
  # shellcheck disable=SC2086
  $RCLONE copyto "$work/$name" "$RCLONE_REMOTE/$name"
  # shellcheck disable=SC2086
  $RCLONE copyto "$work/$name.manifest" "$RCLONE_REMOTE/$name.manifest"
  # shellcheck disable=SC2086
  $RCLONE delete --min-age "${RETENTION_DAYS}d" --include 'hale-*' "$RCLONE_REMOTE"
fi
echo "backup ok: $name (transactions=$tx)"
