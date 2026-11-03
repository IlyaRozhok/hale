#!/usr/bin/env bash
# Changes the owner password, run on the OWNER'S MACHINE (node 22+). Replaces the hash in
# /opt/hale/infra/.env and restarts the api. Devices that are signed in stay signed in.
#
# Usage: DEPLOY_HOST=<server ip> infra/set-password.sh
# Optional: SSH_USER (root), SSH_CMD (default: ssh), REMOTE_DIR (/opt/hale)
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
SSH_USER=${SSH_USER:-root}
SSH_CMD=${SSH_CMD:-ssh}
REMOTE_DIR=${REMOTE_DIR:-/opt/hale}
here=$(cd "$(dirname "$0")/.." && pwd)

IFS= read -rs -p "New owner password: " password
echo >&2
IFS= read -rs -p "Repeat it: " password2
echo >&2
[ -n "$password" ] || { echo "empty password" >&2; exit 1; }
[ "$password" = "$password2" ] || { echo "passwords differ" >&2; exit 1; }

hash=$(cd "$here/apps/api" && HALE_PASSWORD="$password" node -e \
  "import('argon2').then((a) => a.default.hash(process.env.HALE_PASSWORD)).then(console.log)") ||
  { echo "could not hash the password with node $(node -v); the project needs node 22+" >&2; exit 1; }

printf "OWNER_PASSWORD_HASH='%s'\n" "$hash" | $SSH_CMD "$SSH_USER@$DEPLOY_HOST" "set -e; cd '$REMOTE_DIR/infra'
  IFS= read -r line
  sed -i '/^OWNER_PASSWORD_HASH=/d' .env
  printf '%s\n' \"\$line\" >> .env
  docker compose up -d api"
echo "password changed"
