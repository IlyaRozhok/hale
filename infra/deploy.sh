#!/usr/bin/env bash
# Deploy from the OWNER'S MACHINE over SSH (port 22 is firewalled to the
# owner's IP, so CI cannot deploy). Ships the committed tree, builds the image
# on the server, runs migrations, starts the stack, checks /health.
# Exits non-zero if any step fails.
#
# Usage: DEPLOY_HOST=<server ip> DOMAIN=<domain> infra/deploy.sh
# Optional: SSH_USER (root), SSH_CMD (default: ssh), REMOTE_DIR (/opt/tablo),
#           HEALTH_RETRIES (30), SSH_OPTS
# Prereq: /opt/tablo/infra/.env already exists on the server (infra/README.md).
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
: "${DOMAIN:?set DOMAIN (used for the /health check)}"
SSH_USER=${SSH_USER:-root}
SSH_CMD=${SSH_CMD:-ssh}
REMOTE_DIR=${REMOTE_DIR:-/opt/tablo}
HEALTH_RETRIES=${HEALTH_RETRIES:-30}
CURL=${CURL:-curl}
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"

step() { echo "==> $*"; }
remote() { # shellcheck disable=SC2086
  $SSH_CMD ${SSH_OPTS:-} "$SSH_USER@$DEPLOY_HOST" "$@"
}

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: uncommitted changes are NOT deployed (only HEAD is shipped)" >&2
fi
rev=$(git rev-parse --short=12 HEAD)
image="tablo-api:$rev"

step "sync $rev to $DEPLOY_HOST:$REMOTE_DIR/src"
git archive HEAD | remote "set -e; rm -rf '$REMOTE_DIR/src'; mkdir -p '$REMOTE_DIR/src' '$REMOTE_DIR/infra'; tar -x -C '$REMOTE_DIR/src'"

step "install compose files, scripts and cron"
remote "set -e; cd '$REMOTE_DIR'
  test -f infra/.env || { echo 'missing $REMOTE_DIR/infra/.env' >&2; exit 1; }
  cp src/infra/compose.yml src/infra/Caddyfile src/infra/*.sh infra/
  chmod +x infra/*.sh
  install -m 644 src/infra/tablo.cron /etc/cron.d/tablo"

step "build $image on the server"
remote "set -e; cd '$REMOTE_DIR/src' && docker build -f apps/api/Dockerfile -t '$image' ."

step "point compose at $image"
remote "set -e; cd '$REMOTE_DIR/infra'
  sed -i '/^API_IMAGE=/d' .env; echo 'API_IMAGE=$image' >> .env
  docker compose up -d postgres
  docker compose run --rm --no-deps api node dist/db/mig.js run"

step "start stack"
remote "set -e; cd '$REMOTE_DIR/infra' && docker compose up -d --remove-orphans"

step "check https://$DOMAIN/health"
for _ in $(seq 1 "$HEALTH_RETRIES"); do
  if $CURL -fsS "https://$DOMAIN/health"; then
    echo; echo "deploy ok: $image"
    exit 0
  fi
  sleep 5
done
echo "deploy FAILED: /health did not return 200" >&2
exit 1
