#!/usr/bin/env bash
# Starts the local stand for looking at the app in the simulator: a throwaway Postgres with invented
# data and the API on top of it. Nothing here touches the real server or real data.
# Usage: scripts/sim/up.sh          Env: SIM_PG_PORT (55432), SIM_API_PORT (3100)
# State lives in .sim/ (git-ignored): logs, pids and the one-time password (digits only: the
# simulator types in the Russian layout). Stop and wipe with scripts/sim/down.sh.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
state="$root/.sim"
pg_port=${SIM_PG_PORT:-55432}
api_port=${SIM_API_PORT:-3100}
url="postgres://hale:hale@127.0.0.1:$pg_port/hale"

node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null || {
  echo "Node 22 is needed: source ~/.nvm/nvm.sh && nvm use 22" >&2
  exit 1
}
if [ -f "$state/api.pid" ] && kill -0 "$(cat "$state/api.pid")" 2>/dev/null; then
  echo "the stand is already up: http://localhost:$api_port (stop it with scripts/sim/down.sh)" >&2
  exit 1
fi
rm -rf "$state"
mkdir -p "$state"
cd "$root/apps/api"

nohup node "$root/scripts/sim/pg.mjs" "$state/pgdata" "$pg_port" >"$state/pg.log" 2>&1 &
echo $! >"$state/pg.pid"
for _ in $(seq 1 60); do grep -q PG_READY "$state/pg.log" 2>/dev/null && break; sleep 1; done
grep -q PG_READY "$state/pg.log" || { echo "Postgres did not start, see .sim/pg.log" >&2; exit 1; }

DATABASE_URL="$url" npx tsx src/db/mig.ts run >"$state/migrate.log" 2>&1
SIM_PG_PORT="$pg_port" node "$root/scripts/sim/sql.mjs" "$root/scripts/sim/seed.sql" >/dev/null

# The password and the secrets are made here and never printed.
node -e '
  const fs = require("fs"), crypto = require("crypto"), argon2 = require("argon2");
  const [dir] = process.argv.slice(1);
  const password = String(crypto.randomInt(10000000, 99999999));
  fs.writeFileSync(dir + "/password", password, { mode: 0o600 });
  argon2.hash(password).then((hash) => fs.writeFileSync(dir + "/env", [
    "JWT_SECRET=" + crypto.randomBytes(32).toString("hex"),
    // Single quotes: the hash is full of dollar signs.
    "OWNER_PASSWORD_HASH=\x27" + hash + "\x27",
  ].join("\n") + "\n", { mode: 0o600 }));
' "$state"

set -a
# shellcheck disable=SC1091
. "$state/env"
set +a
DATABASE_URL="$url" PORT="$api_port" nohup npx tsx src/main.ts >"$state/api.log" 2>&1 &
echo $! >"$state/api.pid"
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$api_port/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://localhost:$api_port/health" >/dev/null || { echo "the API did not start, see .sim/api.log" >&2; exit 1; }
echo "the stand is up: API http://localhost:$api_port, password in .sim/password"
