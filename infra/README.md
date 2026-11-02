# Infrastructure and operations

One Hetzner Cloud server runs three containers (`infra/compose.yml`): `api`,
`postgres:16` (never published to the host) and `caddy` (HTTPS for `$DOMAIN`).
The Hetzner firewall allows 80 and 443 from anywhere and 22 from the owner's
IP only; 5432 is not reachable from outside.

Nothing here has been applied. Terraform, the first deploy and the DNS record
are owner steps, in the order below.

## Owner gate: first deploy

You need to provide:

1. A Hetzner Cloud project and an API token with read/write access.
2. An SSH key pair; the public key goes to Terraform.
3. Your current public IP (for the SSH firewall rule), as `x.x.x.x/32`.
4. A domain you control, with DNS you can edit.
5. A Hetzner Object Storage bucket plus an access key and secret (backup target).
6. An `age` key pair generated on YOUR machine: `age-keygen -o ~/tablo-backup.key`.
   Only the public key (`age1...`) goes to the server. Keep the private key
   off the server, in your password manager and one other place: without it
   backups cannot be restored.

Then run, in order:

1. `cd infra/terraform && export TF_VAR_hcloud_token=... TF_VAR_owner_ip_cidr=x.x.x.x/32 TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"`
2. `terraform init && terraform plan`, read the plan, then `terraform apply`.
   State is written to `private/terraform/tablo.tfstate` (git-ignored). Back it up.
3. Create a DNS `A` record for your domain pointing at the `server_ipv4` output
   (and `AAAA` for `server_ipv6`). Caddy cannot obtain a certificate before this resolves.
4. Wait for cloud-init to finish (`ssh root@IP cloud-init status --wait`), then
   create `/opt/tablo/infra/.env` on the server (mode 600) with:
   `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ chars),
   `OWNER_PASSWORD_HASH` (argon2, see `.env.example`),
   `DATABASE_URL=postgres://tablo:<POSTGRES_PASSWORD>@postgres:5432/tablo`,
   `AGE_RECIPIENT=age1...` (public key), `RCLONE_REMOTE=hz:<bucket>/tablo`,
   `RCLONE_CONFIG_HZ_TYPE=s3`, `RCLONE_CONFIG_HZ_PROVIDER=Other`,
   `RCLONE_CONFIG_HZ_ENDPOINT=https://<location>.your-objectstorage.com`,
   `RCLONE_CONFIG_HZ_ACCESS_KEY_ID`, `RCLONE_CONFIG_HZ_SECRET_ACCESS_KEY`.
   Wrap EVERY value in single quotes, e.g.
   `OWNER_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'`. Docker Compose
   treats single-quoted values literally; unquoted `$` would be interpolated and
   corrupt the hash (login would fail). Do not double the `$`. The backup cron
   reads only the variables it needs from this file as plain data (quotes
   stripped, nothing evaluated). (`API_IMAGE` is written by `deploy.sh`.)
5. Deploy from your machine (port 22 is open to your IP only, so GitHub
   Actions cannot deploy; CI only builds the image to catch breakage):
   `DEPLOY_HOST=<server ip> DOMAIN=<domain> infra/deploy.sh`.
   It ships the committed tree (`git archive HEAD`) over SSH, builds the image
   on the server, runs migrations, starts the stack and polls
   `https://<domain>/health`; any failing step exits non-zero.
6. Verify: `curl -i https://<domain>/health` returns 200, and from your machine
   `nc -vz <ip> 5432` fails (closed).
7. Run one backup by hand and prove you can restore it (see below) before
   trusting the cron.

## Backups

- `backup.sh` (cron 03:15 UTC): `pg_dump | gzip | age -r <public key>` to Hetzner
  Object Storage via `rclone`, plus a `.manifest` with the transaction count.
  Objects older than 30 days are deleted.
- `restore-check.sh` full mode restores the latest backup into a throwaway
  Postgres and fails (non-zero) if any table is missing or `transactions` has
  fewer rows than the baseline. It needs the age PRIVATE key, which the server
  does not have, so run it from your machine, at least monthly:
  `AGE_IDENTITY_FILE=~/tablo-backup.key RCLONE_REMOTE=... RCLONE_CONFIG_HZ_*=... infra/restore-check.sh`
  (needs docker, or `RESTORE_ADMIN_URL` pointing at a scratch Postgres).
- Full mode without a key fails; it never silently downgrades. Only an explicit
  `--shallow` skips the restore.
- The server's weekly cron (Sunday 04:00 UTC) runs `restore-check.sh --shallow`:
  latest backup exists, is under 36 h old, is non-empty and age-encrypted.
- Failures of either cron job are appended to `/var/log/tablo-jobs.log` and
  inserted into the `jobs` table (`kind` = `backup.failed` /
  `restore_check.failed`, `status` = `failed`, `last_error`).

## Local verification

`infra/verify-bundle.sh` runs `pnpm deploy --prod` (as the Dockerfile does) into
a temp dir outside the repo and proves the built API resolves its dependencies
from there, without Docker.

`pnpm test` runs `infra/test/scripts.test.ts`, which starts a throwaway
Postgres from locally installed binaries (set `PG_BIN` if they are not on
`PATH`; the test skips with a message if none are found) and exercises the
scripts end to end with `ENCRYPT_CMD=cat` standing in for age.
