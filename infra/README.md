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
6. An `age` key pair generated on YOUR machine: `age-keygen -o ~/hale-backup.key`.
   Only the public key (`age1...`) goes to the server. Keep the private key
   off the server, in your password manager and one other place: without it
   backups cannot be restored.

Then run, in order:

1. `cd infra/terraform && export TF_VAR_hcloud_token=... TF_VAR_owner_ip_cidr=x.x.x.x/32 TF_VAR_ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)"`
2. `terraform init && terraform plan`, read the plan, then `terraform apply`.
   State is written to `private/terraform/hale.tfstate` (git-ignored). Back it up.
3. Create a DNS `A` record for your domain pointing at the `server_ipv4` output
   (and `AAAA` for `server_ipv6`). Caddy cannot obtain a certificate before this resolves.
4. Wait for cloud-init to finish (`ssh root@IP cloud-init status --wait`), then
   create `/opt/hale/infra/.env` on the server (mode 600) with:
   `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ chars),
   `OWNER_PASSWORD_HASH` (argon2, see `.env.example`),
   `DATABASE_URL=postgres://hale:<POSTGRES_PASSWORD>@postgres:5432/hale`,
   `AGE_RECIPIENT=age1...` (public key), `RCLONE_REMOTE=hz:<bucket>/hale`,
   `RCLONE_CONFIG_HZ_TYPE=s3`, `RCLONE_CONFIG_HZ_PROVIDER=Other`,
   `RCLONE_CONFIG_HZ_NO_CHECK_BUCKET=true` (otherwise Hetzner rejects uploads with
   `LocationConstraintConflict`),
   `RCLONE_CONFIG_HZ_ENDPOINT=https://<location>.your-objectstorage.com`,
   `RCLONE_CONFIG_HZ_ACCESS_KEY_ID`, `RCLONE_CONFIG_HZ_SECRET_ACCESS_KEY`.
   Wrap EVERY value in single quotes, e.g.
   `OWNER_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$...'`. Docker Compose
   treats single-quoted values literally; unquoted `$` would be interpolated and
   corrupt the hash (login would fail). Do not double the `$`. The backup cron
   reads only the variables it needs from this file as plain data (quotes
   stripped, nothing evaluated). (`API_IMAGE` is written by `deploy.sh`.)
   Optional: `LEDGER_CHECK_ENABLED='true'` turns on the nightly ledger check
   (05:00 Kyiv); unset or empty means off (the default).
5. Deploy from your machine (port 22 is open to your IP only, so GitHub
   Actions cannot deploy; CI only builds the image to catch breakage):
   `DEPLOY_HOST=<server ip> DOMAIN=<domain> infra/deploy.sh`.
   It ships the committed tree (`git archive HEAD`) over SSH, builds the image
   on the server, runs migrations, starts the stack and polls
   `https://<domain>/health`; any failing step exits non-zero.
   На самом первом деплое схемы ещё нет, поэтому бэкап перед миграциями
   пропускаем: `SKIP_BACKUP=1`. Подробнее в разделе «Деплой, откат, логи».
6. Verify: `curl -i https://<domain>/health` returns 200, and from your machine
   `nc -vz <ip> 5432` fails (closed).
7. Run one backup by hand and prove you can restore it (see below) before
   trusting the cron.

## Owner gate: monobank token, webhook and history import

Nothing here has been run. Until the token is set, reconcile and webhook install
skip with one log line and nothing fails. Get a personal token at
https://api.monobank.ua/ (log in with the monobank app).

1. On the server, add to `/opt/hale/infra/.env` (single-quoted like the rest):
   `MONOBANK_TOKEN='<token>'` and
   `MONO_WEBHOOK_SECRET='<24+ chars of A-Za-z0-9_->'` (e.g. `openssl rand -hex 24`).
   `PUBLIC_URL` is set by `compose.yml` to `https://$DOMAIN`.
2. Restart the api: `ssh root@IP 'cd /opt/hale/infra && docker compose up -d api'`.
   On start it compares the webhook in `client-info` with
   `https://$DOMAIN/mono/webhook/<secret>` and registers it if it differs.
3. Sign in to get an owner token, then start the history import from 1 Jan 2025:
   `TOKEN=$(curl -s https://$DOMAIN/auth/login -H 'content-type: application/json' -d '{"password":"<owner password>","deviceName":"cli"}' | jq -r .token)`
   `curl -i -X POST https://$DOMAIN/mono/import -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"from":"2025-01-01"}'`
   Expect `202`. monobank allows one request per 60 s, so the import runs in the
   background for a while (one request per account per 31-day window); it
   resumes by itself after a restart.
4. Check: `docker compose exec postgres psql -U hale -c "select count(*) from transactions"`
   grows; `select kind,status,count(*) from jobs group by 1,2` shows
   `history.window` going from `pending` to `done`; spend a small amount and
   see a `webhook.item` job turn `done` and the row appear; `select last_sync_at from settings`
   is recent. The daily reconcile runs at 04:00 Kyiv time.

## Backups

- Why `DATABASE_URL` uses host `postgres`: `/etc/cron.d/hale` sets
  `PG_DUMP`/`PSQL` to `docker compose exec -T postgres ...`, so the tools run
  inside the postgres container, where `postgres` is the service name. The host
  itself cannot resolve it and Postgres publishes no port, so never call the
  host's own `pg_dump`/`psql` with this URL. A manual run on the server (do not
  `source` the .env file: the argon2 hash would be expanded):
  `cd /opt/hale/infra && PG_DUMP='docker compose exec -T postgres pg_dump' PSQL='docker compose exec -T postgres psql' ENV_FILE=/opt/hale/infra/.env ./cron-run.sh backup ./backup.sh`.
- Running repo scripts against production data (`pnpm seed:private`, `pnpm golden:import`):
  from your machine, `DEPLOY_HOST=<ip> infra/db-tunnel.sh` (keeps running) opens
  `127.0.0.1:15432` to the postgres container over SSH; Postgres stays unpublished.

- `backup.sh` (cron 03:15 UTC): `pg_dump | gzip | age -r <public key>` to Hetzner
  Object Storage via `rclone`, plus a `.manifest` with the transaction count.
  Objects older than 30 days are deleted.
- `restore-check.sh` full mode restores the latest backup into a throwaway
  Postgres and fails (non-zero) if any table is missing or `transactions` has
  fewer rows than the baseline. It needs the age PRIVATE key, which the server
  does not have, so run it from your machine, at least monthly:
  `AGE_IDENTITY_FILE=~/hale-backup.key RCLONE_REMOTE=... RCLONE_CONFIG_HZ_*=... infra/restore-check.sh`
  (needs docker, or `RESTORE_ADMIN_URL` pointing at a scratch Postgres). A local `psql` older
  than 16 fails on `\restrict` in the dump; add `PSQL="docker run --rm -i --network=host postgres:16 psql"`.
- Full mode without a key fails; it never silently downgrades. Only an explicit
  `--shallow` skips the restore.
- The server's weekly cron (Sunday 04:00 UTC) runs `restore-check.sh --shallow`:
  latest backup exists, is under 36 h old, is non-empty and age-encrypted.
- Failures of either cron job are appended to `/var/log/hale-jobs.log` and
  inserted into the `jobs` table (`kind` = `backup.failed` /
  `restore_check.failed`, `status` = `failed`, `last_error`).

## Деплой, откат, логи

- `/health` выполняет `SELECT 1` в Postgres (таймаут 2 с). Ответ `200 {"status":"ok","db":"ok"}`,
  а если база не отвечает, то `503 {"status":"error","db":"down"}`. На это опираются
  `deploy.sh`, `rollback.sh`, healthcheck контейнера `api` в compose и внешний мониторинг (ниже).
- Порядок `deploy.sh`: синхронизация, сборка образа, **бэкап базы** (та же команда, что
  в ночном cron, через `cron-run.sh pre_deploy_backup`), миграции, запуск, проверка
  `/health`, удаление старых образов. Если бэкап упал, деплой останавливается до миграций.
  Вывод бэкапа пишется в `/var/log/hale-jobs.log` на сервере, ошибка также попадает в
  таблицу `jobs` (`pre_deploy_backup.failed`). Флаг `SKIP_BACKUP=1` нужен только для первой установки.
- В конце деплой печатает предыдущий образ и команду отката. Откат:
  `DEPLOY_HOST=<ip> DOMAIN=<domain> infra/rollback.sh <tag>`, где `<tag>` — короткий sha
  (можно и `hale-api:<tag>`). Скрипт проверяет, что образ есть на сервере, переключает
  `API_IMAGE` в `.env`, перезапускает стек и ждёт `/health`. Список доступных образов:
  `ssh root@<ip> docker image ls hale-api`.
- **Откат не отменяет миграции.** Откатываться можно на образ, код которого работает с
  текущей схемой (миграции в Hale только добавляют). Если новая миграция сломала
  данные, нужно восстанавливать бэкап, сделанный перед деплоем (раздел Backups).
- После успешного деплоя `prune-images.sh` оставляет 3 последних образа `hale-api`
  (плюс текущий) и удаляет висящие слои сборки. Сбой очистки не валит деплой.
- Логи контейнеров ротируются (`x-logging` в `compose.yml`): json-file, до 5 файлов по
  10 МБ на контейнер. Применяется при пересоздании контейнеров, то есть при ближайшем деплое.

## Внешние алерты (предложение, не подключено)

Сейчас о сбоях никто не узнаёт: падение бэкапа видно только в `jobs` и в логе, а
лежащий API заметен, только когда не открывается приложение. Предлагаю два бесплатных
внешних сигнала, оба без кода на сервере сверх пары строк. Регистрироваться и
подключать будет владелец.

1. **Пинг `/health`.** UptimeRobot (бесплатно: 50 мониторов, проверка раз в 5 минут;
   Healthchecks.io сам ничего не опрашивает, он только принимает пинги):
   монитор HTTP(s) на `https://api.halemoney.com/health`, ожидается код 200,
   уведомление на почту и в Telegram. Так как `/health` теперь трогает базу, монитор
   ловит и упавший API, и упавший Postgres, и истёкший сертификат.
2. **Heartbeat бэкапа.** Healthchecks.io (бесплатно: 20 проверок). Завести проверку
   «backup» с периодом 1 день и grace 6 часов, положить её URL в `.env` как
   `HEALTHCHECK_BACKUP_URL='https://hc-ping.com/<uuid>'`. В `cron-run.sh` после
   выполнения задания добавить (и разрешить `HEALTHCHECK_*` в `load_env`):
   `curl -fsS -m 10 --retry 3 "$HEALTHCHECK_BACKUP_URL/$code" >/dev/null || true`,
   где `/0` означает успех, а ненулевой код — сбой. Healthchecks пришлёт письмо и
   при явной ошибке, и если пинг не пришёл вовсе (сервер выключен, cron сломан).
   Ту же схему можно повесить на еженедельный `restore_check`.

Что нужно от владельца: аккаунты в UptimeRobot и Healthchecks.io, каналы уведомлений
(почта и/или Telegram), согласие на правку `.env` на сервере. После этого изменение в
`cron-run.sh` делается отдельной задачей с тестом.

## Local verification

`infra/verify-bundle.sh` runs `pnpm deploy --prod` (as the Dockerfile does) into
a temp dir outside the repo and proves the built API resolves its dependencies
from there, without Docker.

`pnpm test` runs `infra/test/scripts.test.ts`, which starts a throwaway
Postgres from locally installed binaries (set `PG_BIN` if they are not on
`PATH`; the test skips with a message if none are found) and exercises the
scripts end to end with `ENCRYPT_CMD=cat` standing in for age.
