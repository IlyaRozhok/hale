#!/usr/bin/env bash
# Deploy from the OWNER'S MACHINE over SSH (port 22 is firewalled to the
# owner's IP, so CI cannot deploy). Ships the committed tree, builds the image
# on the server, backs up the database, runs migrations, starts the stack,
# checks /health (which really queries Postgres), then prunes old images.
# Exits non-zero if any step fails.
#
# Usage: DEPLOY_HOST=<server ip> DOMAIN=<domain> infra/deploy.sh
# Optional: SSH_USER (root), SSH_CMD (default: ssh), REMOTE_DIR (/opt/hale),
#           HEALTH_RETRIES (30), HEALTH_SLEEP (5), SSH_OPTS,
#           SKIP_BACKUP=1 (only for the very first install: no schema yet)
# Prereq: /opt/hale/infra/.env already exists on the server (infra/README.md).
# Rollback: infra/rollback.sh <previous tag> (printed at the end).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
# shellcheck source=infra/common.sh
. "$here/infra/common.sh"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: uncommitted changes are NOT deployed (only HEAD is shipped)" >&2
fi
rev=$(git rev-parse --short=12 HEAD)
image="hale-api:$rev"

step "sync $rev to $DEPLOY_HOST:$REMOTE_DIR/src"
git archive HEAD | remote "set -e; rm -rf '$REMOTE_DIR/src'; mkdir -p '$REMOTE_DIR/src' '$REMOTE_DIR/infra'; tar -x -C '$REMOTE_DIR/src'"

step "install compose files, scripts and cron"
remote "set -e; cd '$REMOTE_DIR'
  test -f infra/.env || { echo 'missing $REMOTE_DIR/infra/.env' >&2; exit 1; }
  cp src/infra/compose.yml src/infra/Caddyfile src/infra/*.sh infra/
  chmod +x infra/*.sh
  install -m 644 src/infra/hale.cron /etc/cron.d/hale"

step "build $image on the server"
remote "set -e; cd '$REMOTE_DIR/src' && docker build -f apps/api/Dockerfile -t '$image' ."
prev=$(current_image)

if [ "${SKIP_BACKUP:-}" = 1 ]; then
  step "backup SKIPPED (SKIP_BACKUP=1)"
else
  # Same command line as the nightly cron job (hale.cron): dump inside the
  # postgres container, encrypt, ship off-site; a failure is also recorded in
  # the jobs table. Output goes to /var/log/hale-jobs.log, not to this terminal.
  step "backup the database before migrations"
  remote "set -e; cd '$REMOTE_DIR/infra'
    docker compose up -d --wait postgres
    ENV_FILE='$REMOTE_DIR/infra/.env' \
    PG_DUMP='docker compose -f $REMOTE_DIR/infra/compose.yml exec -T postgres pg_dump' \
    PSQL='docker compose -f $REMOTE_DIR/infra/compose.yml exec -T postgres psql' \
      ./cron-run.sh pre_deploy_backup ./backup.sh" || {
    echo "deploy FAILED: backup before migrations FAILED (see /var/log/hale-jobs.log on the server); nothing was migrated" >&2
    exit 1
  }
fi

step "point compose at $image and migrate"
remote "set -e; cd '$REMOTE_DIR/infra'
  sed -i '/^API_IMAGE=/d' .env; echo 'API_IMAGE=$image' >> .env
  docker compose up -d --wait postgres
  docker compose run --rm --no-deps api node dist/db/mig.js run"

step "start stack"
remote "set -e; cd '$REMOTE_DIR/infra' && docker compose up -d --remove-orphans"

step "check https://$DOMAIN/health"
if ! wait_health; then
  echo "deploy FAILED: /health did not return 200" >&2
  [ -n "$prev" ] && echo "roll back with: infra/rollback.sh ${prev#hale-api:}" >&2
  exit 1
fi
echo "deploy ok: $image"

step "prune old hale-api images (keep the last 3)"
remote "'$REMOTE_DIR/infra/prune-images.sh' '$image'" || echo "warning: image prune failed (deploy itself is ok)" >&2
[ -n "$prev" ] && [ "$prev" != "$image" ] && echo "previous image: $prev; roll back with: infra/rollback.sh ${prev#hale-api:}"
exit 0
