#!/usr/bin/env bash
# Docker-free check of the production runtime layout: `pnpm deploy --prod` into
# a temp dir OUTSIDE the monorepo (the same thing the Dockerfile does), then
# prove the built entry points can resolve every dependency from there.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cd "$root"
pnpm --filter @hale/api build >/dev/null
pnpm --filter @hale/api deploy --prod "$out/app" >/dev/null
cd "$out/app"

# mig.js imports typeorm/pg at load; with no args it prints usage and exits 2.
set +e
usage=$(node dist/db/mig.js 2>&1); code=$?
set -e
if ! { [ "$code" -eq 2 ] && grep -q "usage: mig.ts" <<<"$usage"; }; then
  echo "mig.js did not load: $usage" >&2; exit 1
fi

# main.js loads nest/argon2/etc., then must fail on configuration, not imports.
set +e
err=$(env -i PATH="$PATH" node dist/main.js 2>&1); code=$?
set -e
if grep -q "ERR_MODULE_NOT_FOUND\|Cannot find" <<<"$err"; then echo "$err" >&2; exit 1; fi
grep -q "Invalid configuration" <<<"$err" || { echo "unexpected main.js output: $err" >&2; exit 1; }
echo "verify-bundle ok: dependencies resolve from a detached pnpm deploy tree"
