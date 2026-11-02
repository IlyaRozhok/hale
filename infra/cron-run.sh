#!/usr/bin/env bash
# Runs a job script for cron: logs output, and on failure records a row in the
# `jobs` table so the failure is visible in the app database.
# Usage: cron-run.sh <job-name> <command> [args...]
# Env: ENV_FILE (parsed, not sourced), LOG_FILE, DATABASE_URL, PSQL
set -uo pipefail
name=${1:?job name}; shift
# Read ONLY the variables the jobs need from ENV_FILE. The file is parsed as
# data, never sourced: it also holds docker-compose values such as an argon2
# hash ('$argon2id$...') that a shell would expand (and `set -u` would abort on).
# Surrounding single or double quotes are stripped; no other processing.
load_env() {
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      DATABASE_URL=* | AGE_RECIPIENT=* | RCLONE_REMOTE=* | RCLONE_CONFIG_*=* | BACKUP_DIR=* | RETENTION_DAYS=* | MAX_AGE_HOURS=*) ;;
      *) continue ;;
    esac
    key=${line%%=*}
    val=${line#*=}
    case "$val" in
      \'*\') val=${val#\'}; val=${val%\'} ;;
      \"*\") val=${val#\"}; val=${val%\"} ;;
    esac
    export "$key=$val"
  done < "$1"
}
if [ -n "${ENV_FILE:-}" ]; then load_env "$ENV_FILE"; fi
LOG_FILE=${LOG_FILE:-/var/log/tablo-jobs.log}
PSQL=${PSQL:-psql}
out=$(mktemp); trap 'rm -f "$out"' EXIT

"$@" >"$out" 2>&1
code=$?
{ echo "--- $(date -u +%FT%TZ) $name exit=$code"; cat "$out"; } >> "$LOG_FILE"
[ "$code" -eq 0 ] && exit 0

err=$(tail -c 2000 "$out")
echo "$name failed (exit $code); recording in jobs table" >> "$LOG_FILE"
# shellcheck disable=SC2086
printf '%s\n' "insert into jobs (kind, status, attempts, last_error) values (:'kind', 'failed', 1, :'err')" |
  $PSQL "${DATABASE_URL:?}" -q -v ON_ERROR_STOP=1 -v "kind=$name.failed" -v "err=$err" \
  || echo "could not write to jobs table" >> "$LOG_FILE"
exit "$code"
