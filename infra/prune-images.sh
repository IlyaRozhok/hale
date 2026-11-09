#!/usr/bin/env bash
# Runs ON THE SERVER after a successful deploy: keeps the newest $KEEP
# hale-api images (rollback targets) plus the one running now, removes older
# ones and dangling build layers. Never fails the deploy.
# Usage: prune-images.sh <current image>   Env: KEEP (3), DOCKER (docker)
set -uo pipefail
current=${1:?current image, e.g. hale-api:0123456789ab}
KEEP=${KEEP:-3}
DOCKER=${DOCKER:-docker}

# `docker image ls` lists newest first.
# shellcheck disable=SC2086
$DOCKER image ls hale-api --format '{{.Repository}}:{{.Tag}}' |
  grep -v ':<none>$' | tail -n "+$((KEEP + 1))" | grep -vxF "$current" |
  while IFS= read -r img; do
    # shellcheck disable=SC2086
    $DOCKER image rm "$img" >/dev/null || echo "prune: could not remove $img (in use?)" >&2
  done
# shellcheck disable=SC2086
$DOCKER image prune -f >/dev/null || true
exit 0
