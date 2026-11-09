#!/usr/bin/env bash
# Roll the API back to an image that is still on the server (deploy keeps the
# last 3): points compose at hale-api:<tag>, restarts, checks /health.
# Run from the OWNER'S MACHINE, like deploy.sh.
#
# Usage: DEPLOY_HOST=<ip> DOMAIN=<domain> infra/rollback.sh <tag | hale-api:tag>
# List candidates: ssh root@<ip> docker image ls hale-api
#
# Migrations are NOT reverted. Roll back only to an image whose code works with
# the current schema; otherwise restore a backup (infra/README.md).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tag=${1:-}
tag=${tag#hale-api:}
if ! [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "usage: rollback.sh <tag>  (a git short sha such as 0123456789ab)" >&2
  exit 2
fi
# shellcheck source=infra/common.sh
. "$here/common.sh"
image="hale-api:$tag"

step "check $image exists on $DEPLOY_HOST"
remote "docker image inspect $image >/dev/null" ||
  { echo "rollback FAILED: $image is not on the server" >&2; exit 1; }
prev=$(current_image)

step "point compose at $image (was: ${prev:-unknown})"
remote "set -e; cd '$REMOTE_DIR/infra'
  sed -i '/^API_IMAGE=/d' .env; echo 'API_IMAGE=$image' >> .env
  docker compose up -d --remove-orphans"

step "check https://$DOMAIN/health"
if wait_health; then
  echo "rollback ok: $image"
  exit 0
fi
echo "rollback FAILED: /health did not return 200 for $image" >&2
exit 1
