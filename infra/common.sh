# shellcheck shell=bash
# Shared by deploy.sh and rollback.sh (sourced, not executed).
# Needs: DEPLOY_HOST, DOMAIN. Optional: SSH_USER (root), SSH_CMD (ssh),
# SSH_OPTS, REMOTE_DIR (/opt/hale), HEALTH_RETRIES (30), HEALTH_SLEEP (5), CURL.
: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
: "${DOMAIN:?set DOMAIN (used for the /health check)}"
SSH_USER=${SSH_USER:-root}
SSH_CMD=${SSH_CMD:-ssh}
REMOTE_DIR=${REMOTE_DIR:-/opt/hale}
HEALTH_RETRIES=${HEALTH_RETRIES:-30}
HEALTH_SLEEP=${HEALTH_SLEEP:-5}
CURL=${CURL:-curl}

step() { echo "==> $*"; }
remote() { # shellcheck disable=SC2086
  $SSH_CMD ${SSH_OPTS:-} "$SSH_USER@$DEPLOY_HOST" "$@"
}

# The image compose runs now (empty if unknown), e.g. "hale-api:0123456789ab".
current_image() {
  local line
  line=$(remote "grep ^API_IMAGE= '$REMOTE_DIR/infra/.env' || true" | tail -n 1)
  echo "${line#API_IMAGE=}"
}

# 0 once https://$DOMAIN/health answers 200 (the API reaches Postgres), else 1.
wait_health() {
  for _ in $(seq 1 "$HEALTH_RETRIES"); do
    if $CURL -fsS "https://$DOMAIN/health"; then echo; return 0; fi
    sleep "$HEALTH_SLEEP"
  done
  echo "/health did not return 200 after $HEALTH_RETRIES tries" >&2
  return 1
}
