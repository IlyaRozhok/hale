#!/usr/bin/env bash
# SSH tunnel from the OWNER'S MACHINE to the production Postgres, for running
# `pnpm seed:private` / `pnpm golden:import` locally. Postgres stays unpublished:
# the script looks up the container's IP on the server's docker network and
# forwards 127.0.0.1:$LOCAL_PORT to <ip>:5432 over SSH. Ctrl-C closes it.
#
# Usage: DEPLOY_HOST=<server ip> infra/db-tunnel.sh
# Optional: SSH_USER (root), SSH_CMD (ssh), SSH_OPTS, LOCAL_PORT (15432),
#           REMOTE_DIR (/opt/tablo)
# Then: DATABASE_URL=postgres://tablo:<POSTGRES_PASSWORD>@127.0.0.1:15432/tablo
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
SSH_USER=${SSH_USER:-root}
SSH_CMD=${SSH_CMD:-ssh}
LOCAL_PORT=${LOCAL_PORT:-15432}
REMOTE_DIR=${REMOTE_DIR:-/opt/tablo}

# shellcheck disable=SC2086
ip=$($SSH_CMD ${SSH_OPTS:-} "$SSH_USER@$DEPLOY_HOST" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \$(cd '$REMOTE_DIR/infra' && docker compose ps -q postgres)")
ip=$(printf '%s' "$ip" | tr -d '[:space:]')
# Exactly one IPv4 address: a container on several networks prints them glued together.
if ! [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "db-tunnel: could not find the postgres container IP (got '$ip'); is the stack up, on one network?" >&2
  exit 1
fi
echo "tunnel: 127.0.0.1:$LOCAL_PORT -> $ip:5432 via $DEPLOY_HOST (Ctrl-C to close)" >&2
# shellcheck disable=SC2086
exec $SSH_CMD ${SSH_OPTS:-} -N -L "127.0.0.1:$LOCAL_PORT:$ip:5432" "$SSH_USER@$DEPLOY_HOST"
