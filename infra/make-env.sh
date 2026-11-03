#!/usr/bin/env bash
# First-deploy helper, run on the OWNER'S MACHINE: generates the secrets, asks for
# the rest and writes /opt/hale/infra/.env on the server (mode 600). Prints no secret.
# Refuses to overwrite an existing file, because a new POSTGRES_PASSWORD would not
# match the one the database was created with.
#
# Usage: DEPLOY_HOST=<server ip> DOMAIN=<domain> BUCKET=<bucket> S3_LOCATION=<hel1|fsn1|nbg1> infra/make-env.sh
# Optional: SSH_USER (root), SSH_CMD (default: ssh), REMOTE_DIR (/opt/hale),
#           AGE_KEY_FILE (~/hale-backup.key)
# The monobank token is added later (infra/README.md), after the first deploy works.
set -euo pipefail

: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP}"
: "${DOMAIN:?set DOMAIN, e.g. api.example.com}"
: "${BUCKET:?set BUCKET to the Object Storage bucket name}"
: "${S3_LOCATION:?set S3_LOCATION to the bucket location, e.g. hel1}"
SSH_USER=${SSH_USER:-root}
SSH_CMD=${SSH_CMD:-ssh}
REMOTE_DIR=${REMOTE_DIR:-/opt/hale}
AGE_KEY_FILE=${AGE_KEY_FILE:-$HOME/hale-backup.key}
here=$(cd "$(dirname "$0")/.." && pwd)

ask_secret() { # prompt, result variable
  local value
  IFS= read -rs -p "$1: " value
  echo >&2
  [ -n "$value" ] || { echo "empty value" >&2; exit 1; }
  case "$value" in *"'"*) echo "single quotes are not allowed" >&2; exit 1 ;; esac
  printf -v "$2" '%s' "$value"
}

recipient=$(age-keygen -y "$AGE_KEY_FILE")

ask_secret "Owner password (the app login)" password
ask_secret "Repeat the owner password" password2
[ "$password" = "$password2" ] || { echo "passwords differ" >&2; exit 1; }
ask_secret "Object Storage access key" s3_key
ask_secret "Object Storage secret key" s3_secret

hash=$(cd "$here/apps/api" && HALE_PASSWORD="$password" node -e \
  "import('argon2').then((a) => a.default.hash(process.env.HALE_PASSWORD)).then(console.log)") ||
  { echo "could not hash the password with node $(node -v); the project needs node 22+" >&2; exit 1; }

pg_password=$(openssl rand -hex 32)

$SSH_CMD "$SSH_USER@$DEPLOY_HOST" "set -e; umask 077; mkdir -p '$REMOTE_DIR/infra'
  test ! -e '$REMOTE_DIR/infra/.env' || { echo '$REMOTE_DIR/infra/.env already exists' >&2; exit 1; }
  cat > '$REMOTE_DIR/infra/.env'" <<EOF
DOMAIN='$DOMAIN'
POSTGRES_PASSWORD='$pg_password'
DATABASE_URL='postgres://hale:$pg_password@postgres:5432/hale'
JWT_SECRET='$(openssl rand -hex 48)'
OWNER_PASSWORD_HASH='$hash'
MONO_WEBHOOK_SECRET='$(openssl rand -hex 24)'
AGE_RECIPIENT='$recipient'
RCLONE_REMOTE='hz:$BUCKET/hale'
RCLONE_CONFIG_HZ_TYPE='s3'
RCLONE_CONFIG_HZ_PROVIDER='Other'
RCLONE_CONFIG_HZ_ENDPOINT='https://$S3_LOCATION.your-objectstorage.com'
RCLONE_CONFIG_HZ_ACCESS_KEY_ID='$s3_key'
RCLONE_CONFIG_HZ_SECRET_ACCESS_KEY='$s3_secret'
RCLONE_CONFIG_HZ_NO_CHECK_BUCKET='true'
EOF
echo "wrote $REMOTE_DIR/infra/.env on $DEPLOY_HOST"
