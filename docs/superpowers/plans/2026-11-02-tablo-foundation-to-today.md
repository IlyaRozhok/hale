# Tablo: от фундамента до экрана «Сегодня» на iPhone. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Приложение, которым владелец пользуется каждый день: импорт monobank, типы операций, дневной лимит и режим моста, напоминания о налогах, экран «Сегодня» на iPhone с ртутью и кольцом.

**Architecture:** Монорепозиторий pnpm. NestJS API на одном сервере Hetzner считает всё чистыми функциями в `apps/api/src/domain`, Expo-приложение только показывает результат. Контракты общие, через `packages/contracts`, цвета только через `packages/tokens`.

**Tech Stack:** TypeScript strict, pnpm, Vitest, NestJS, TypeORM, PostgreSQL 16, Zod, Expo, React Native Skia, TanStack Query, expo-notifications, Terraform (hcloud), Docker Compose, Caddy, age.

**Spec:** `docs/superpowers/specs/2026-11-02-personal-finance-app-design.md`. Шаги 1–5 из §10.

**Следующие планы, не здесь:** цели и калькулятор рассрочек (шаг 6), AI (шаг 7), веб (шаг 8), виджет и API Binance (шаг 9). Без AI незнакомый продавец получает категорию `uncategorized`.

## Global Constraints

- Репозиторий приватный. Реальные выписки и цифры владельца не попадают в git, каталог `private/` в `.gitignore`.
- Деньги: целые копейки и центы, `bigint` в БД, целое число в TypeScript. Без дробей и `float` в расчётах.
- Вся логика денег на бэкенде. Приложения её не считают.
- Часовой пояс расчётов: `Europe/Kyiv`.
- Personal API monobank: не чаще 1 запроса в 60 с, окно выписки до 2,682,000 с. Webhook отвечает `200` быстрее 5 с.
- Токен monobank только в секретах сервера. Ошибки API бросаются, а не возвращаются как данные.
- `creditLimit` никогда не входит в свои деньги.
- Цвет в компонентах только через семантические токены, прямые значения запрещены проверкой в CI. Рамок нет.
- Только чёрный, белый, серебро. Статус всегда подписан текстом.
- Текст интерфейса на русском, спокойным тоном, без упрёков. Суммы в гривнах, рядом доллары.
- Не больше одного обычного уведомления в день, налоговые напоминания сверх этого лимита.

## Review Focus

1. **Повторная доставка и изменение `hold`.** Один `id` приходит из вебхука и из сверки, с другой суммой: трата считается один раз, с последней суммой. Тест в Task 7.
2. **monobank недоступен или токен отозван.** Экран показывает последние данные и время обновления, лимит не обнуляется. Тесты в Task 11 и Task 15.
3. **Граница суток и перевод часов.** Операция в 23:59 и 00:01 по Киеву, ночь 25 октября: снимок лимита и траты относятся к правильной дате. Тест в Task 10.
4. **Счёт не в гривне.** Счёт ФОП в USD (`currencyCode` 840): свои деньги и налог пересчитываются по курсу, при отсутствии курса используется последний сохранённый и показывается пометка. Тесты в Task 10 и Task 12.
5. **Банк изменил кредитный лимит или ожидаемых доходов нет.** Снижение `creditLimit` меняет `own_money`, а не считается тратой. Без ожидаемых доходов приложение просит дату и не делит на ноль. Тест в Task 10.

## Что делает владелец

Эти шаги нельзя выполнить за него. Токены он вводит сам, в чат их не присылает.

- Task 1: приватный репозиторий на GitHub.
- Task 4: API-токен Hetzner, домен, место для бэкапов, ключ age.
- Task 7: токен monobank в секретах сервера.
- Task 8: файл `transactions.csv` в `private/`.
- Task 14 и Task 17: аккаунт Apple Developer, прогон на своём iPhone.

## Структура файлов

```
apps/api/src/
  domain/          чистые функции: money, daily, tax, classify, recurring-match
  mono/            клиент, импорт, вебхук, сверка
  db/              сущности, миграции
  auth/ plan/ today/ transactions/ notifications/
apps/api/scripts/  golden-classify.ts, golden-import.ts, seed-private.ts
apps/mobile/src/
  metal/           LimitVisual, Mercury, Ring, metal.sksl.ts, level.ts
  screens/         Login, Today, Activity, Settings
  api/             клиент, запросы
packages/contracts/src/index.ts
packages/tokens/src/{palette,semantic,index}.ts
infra/             terraform/, compose.yml, Caddyfile, backup.sh, restore-check.sh
scripts/check-raw-colors.mjs
```

---

### Task 1: Монорепозиторий и CI

**Files:**
- Create: `/Users/irozhok/Desktop/tablo/` с `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.nvmrc`, `.github/workflows/ci.yml`, `docs/` с копией описания и этого плана
- Create: `scripts/check-raw-colors.mjs`
- Test: `scripts/check-raw-colors.test.mjs`

**Interfaces:**
- Produces: команды `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:colors`

- [ ] **Step 1: Создать git-репозиторий.** Ветка `main`, Node 22, `strict: true`, `noUncheckedIndexedAccess: true`. В `.gitignore`: `node_modules`, `dist`, `.env*`, `private/`, `*.tfstate*`, `.superpowers/`. Скопировать описание, этот план и `mockups/liquid-metal.html` в `docs/superpowers/`.
- [ ] **Step 2: Написать падающий тест `check-raw-colors`:** файл с `#fff`, `rgb(` или `rgba(` в `apps/*/src` даёт код 1 и путь; файл без них даёт код 0; `packages/tokens` не проверяется.
- [ ] **Step 3: Запустить** `pnpm test scripts`. Ожидается: FAIL.
- [ ] **Step 4: Реализовать скрипт, добавить CI:** `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `check:colors`.
- [ ] **Step 5: Запустить** все четыре команды. Ожидается: успех.
- [ ] **Step 6: Коммит** `chore: scaffold monorepo and CI`. Создание приватного удалённого репозитория и первый push подтверждает владелец.

### Task 2: Дизайн-токены

**Files:**
- Create: `packages/tokens/src/palette.ts`, `semantic.ts`, `index.ts`
- Test: `packages/tokens/src/contrast.test.ts`

**Interfaces:**
- Produces: `tokens.color.{fg,surface,status,accent,money,data}`, `tokens.space`, `tokens.radius`, `tokens.type`, `tokens.touchMin = 44`, а также `contrastRatio(a: string, b: string): number`

- [ ] **Step 1: Написать падающий тест:** `fg.default` на `surface.base` и на `surface.raised` не ниже 4.5:1, `fg.muted` не ниже 4.5:1, `status.success` на `surface.base` не ниже 4.5:1, `accent.fgOnAccent` на `accent.default` не ниже 4.5:1.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Значения Silver брать из `tablo-web/src/shared/config/theme/palette.ts`. `surface` непрозрачные, полупрозрачные поверхности отдельным токеном `surface.glass`. Палитра не экспортируется из `index.ts`.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(tokens): add semantic silver tokens`.

### Task 3: API, база, вход

**Files:**
- Create: `apps/api/` (Nest), `src/config.ts`, `src/db/entities/*.ts`, `src/db/migrations/0001-init.ts`, `src/auth/*`, `compose.dev.yml`
- Test: `apps/api/test/auth.e2e.test.ts`, `src/config.test.ts`

**Interfaces:**
- Produces: `AppConfig` (Zod, падает при старте без `DATABASE_URL`, `JWT_SECRET`, `OWNER_PASSWORD_HASH`), `AuthGuard` на всех маршрутах, кроме `/health`, `/auth/login` и вебхука; `POST /auth/login {password, deviceName} -> {token}`

Таблицы первой миграции. Сумма всегда `bigint`, дата как `date`, момент как `timestamptz`:

| Таблица | Поля |
|---|---|
| `accounts` | `id`, `external_id` unique, `kind` (black, white, fop, jar, other), `currency`, `balance`, `credit_limit`, `balance_at` |
| `transactions` | `id`, `external_id` unique, `account_id`, `occurred_at`, `local_date`, `description`, `comment`, `mcc`, `amount`, `amount_uah`, `fx_rate`, `hold`, `counter_iban`, `counter_name`, `type`, `category`, `type_source` (rule, owner, auto), `raw` jsonb |
| `rules` | `id`, `match_kind` (merchant, iban, recipient), `match_value`, `type`, `category`, `label` |
| `expected_incomes` | `id`, `source` (fop, usdc), `amount`, `currency`, `window_start_day`, `window_end_day` |
| `income_events` | `id`, `expected_income_id`, `period` (YYYY-MM), `expected_on`, `received_at`, `amount_uah`, `status` |
| `scheduled_payments` | `id`, `kind` (obligation, installment, tax), `name`, `amount`, `currency`, `due_on`, `paid_at`, `transaction_id`, `match_hint`, `overpayment` |
| `manual_balances` | `id`, `name`, `amount`, `currency`, `counts_as_own` |
| `loans` | `id`, `amount`, `received_on`, `source_transaction_id`, `repaid_at`, `note` |
| `settings` | одна строка: `lifestyle_cap`, `food_floor`, `tax_rate_bp` (600), `esv_quarter`, `limit_visual` (mercury, ring) |
| `bridge_plans` | `id`, `daily_amount`, `credit_plan`, `created_on`, `closed_on` |
| `daily_snapshots` | `local_date` PK, `daily_limit`, `mode` |
| `fx_rates` | `currency`, `rate`, `fetched_at` |
| `jobs` | `id`, `kind`, `payload`, `run_after`, `status`, `attempts`, `last_error` |
| `devices` | `id`, `name`, `push_token`, `token_hash` |
| `notifications_log` | `key` unique, `sent_at`, `kind` |

- [ ] **Step 1: Написать падающие тесты:** конфиг без `JWT_SECRET` бросает ошибку; `POST /auth/login` с неверным паролем даёт 401; пять неверных подряд дают 429; `/today` без токена даёт 401; `/health` даёт 200.
- [ ] **Step 2: Запустить** с Postgres из `compose.dev.yml`. Ожидается FAIL.
- [ ] **Step 3: Реализовать.** Хэш через `argon2`, токен устройства с хранением только хэша. `synchronize: false`. Столбцы `bigint` через трансформер в `number` с проверкой `Number.isSafeInteger`.
- [ ] **Step 4: Запустить**, ожидается PASS. Проверить `mig:run` и `mig:revert` на чистой базе.
- [ ] **Step 5: Коммит** `feat(api): add schema and owner auth`.

### Task 4: Сервер, деплой, бэкапы

**Files:**
- Create: `infra/terraform/*.tf`, `infra/compose.yml`, `infra/Caddyfile`, `infra/backup.sh`, `infra/restore-check.sh`, `apps/api/Dockerfile`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: образ API из Task 3
- Produces: `https://<domain>/health`, ежедневный бэкап

- [ ] **Step 1: Описать в Terraform:** один сервер `hcloud`, файрвол только 22, 80, 443 (22 с IP владельца), ключ SSH, удалённый backend состояния либо файл вне git.
- [ ] **Step 2: Запустить** `terraform validate`. Ожидается: `Success`.
- [ ] **Step 3: Написать `restore-check.sh`:** поднимает временный Postgres, восстанавливает последний бэкап, проверяет наличие всех таблиц и число строк `transactions` не меньше, чем в источнике, код выхода не 0 при ошибке.
- [ ] **Step 4: Написать `backup.sh`:** `pg_dump | age -r <ключ>`, отправка вне сервера, хранение 30 дней. Cron раз в сутки, недельный запуск `restore-check.sh`, ошибка уходит в лог и таблицу `jobs`.
- [ ] **Step 5: Проверить локально:** `backup.sh`, затем `restore-check.sh` на `compose.dev.yml`. Ожидается: код 0.
- [ ] **Step 6: Владелец подтверждает `terraform apply` и первый деплой.** Проверка: `curl https://<domain>/health` возвращает 200, а порт 5432 закрыт снаружи.
- [ ] **Step 7: Коммит** `feat(infra): add Hetzner server, deploy and backups`.

### Task 5: Клиент monobank

**Files:**
- Create: `apps/api/src/mono/mono.client.ts`, `mono.schemas.ts`, `rate-gate.ts`
- Test: `apps/api/src/mono/mono.client.test.ts`

**Interfaces:**
- Produces: `MonoClient.clientInfo(): Promise<MonoClientInfo>`, `.statement(accountId, from, to): Promise<MonoStatementItem[]>`, `.setWebhook(url): Promise<void>`, `.currency(): Promise<MonoRate[]>`; `RateGate.acquire(): Promise<void>`; ошибка `MonoApiError {status, retryAfter?}`

- [ ] **Step 1: Написать падающие тесты** с подменой HTTP: два запроса подряд через `RateGate` идут с разницей не меньше 60 с на фейковых часах; ответ 429 бросает `MonoApiError` со `status: 429`; ответ 401 бросает ошибку; лишние и отсутствующие необязательные поля (`comment`, `counterIban`) проходят, отсутствие `id` даёт ошибку; `statement` с окном больше 2,682,000 с бросает ошибку до запроса; токен не попадает в текст ошибки.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Схемы Zod по §4 описания. `currency` публичный и через `RateGate` не идёт. Заголовок `X-Token`.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(mono): add typed client with rate gate`.

### Task 6: Импорт истории

**Files:**
- Create: `apps/api/src/mono/import.service.ts`, `jobs/job-runner.ts`, `windows.ts`
- Test: `apps/api/src/mono/import.service.test.ts`, `windows.test.ts`

**Interfaces:**
- Consumes: `MonoClient`, `RateGate`
- Produces: `planWindows(fromSec, toSec): Array<[number, number]>`, `ImportService.enqueueHistory(from: Date)`, `upsertStatementItem(accountId, item): Promise<Transaction>`, `JobRunner`

- [ ] **Step 1: Написать падающие тесты:** `planWindows` за 2 года даёт окна не длиннее 2,682,000 с без пропусков; импорт, прерванный посреди, продолжается с невыполненного окна; ответ из 500 строк и больше делит окно пополам и запрашивает обе части (порог задан решением автора, документация лимит не называет); сбой окна повторяется с паузой, после 5 попыток становится `failed` и не блокирует другие счета.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Очередь в таблице `jobs`, блокировка через `FOR UPDATE SKIP LOCKED`, `@nestjs/schedule` раз в 10 с. `local_date` считать по `Europe/Kyiv`. Банки (`jars`) импортируются как счета вида `jar`.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(mono): add resumable history import`.

### Task 7: Вебхук и ежедневная сверка

**Files:**
- Create: `apps/api/src/mono/webhook.controller.ts`, `reconcile.service.ts`
- Test: `apps/api/test/webhook.e2e.test.ts`, `src/mono/reconcile.service.test.ts`

**Interfaces:**
- Consumes: `upsertStatementItem`, `MonoClient`
- Produces: `GET|POST /mono/webhook/:secret`, `ReconcileService.runDaily()`

- [ ] **Step 1: Написать падающие тесты:** неверный секрет даёт 404; `GET` с верным даёт 200; `POST` отвечает 200 до обработки, событие обрабатывается задачей; **один `id` из вебхука и сверки создаёт одну строку, а новая сумма и `hold: false` заменяют прежние** (Review Focus 1); сверка находит пропущенную операцию; если `webHookUrl` в `client-info` не наш, вебхук ставится заново; `client-info` обновляет `balance` и `credit_limit`.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Сверка раз в сутки в 04:00 по Киеву за последние 7 дней. Секрет из конфига. Сравнение секрета постоянным по времени. Раз в час обновлять `/bank/currency` в `fx_rates`.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Владелец вносит токен в секреты сервера, запускается импорт с 1 января 2025.** Проверка: `transactions` заполняется, вебхук получает реальную операцию.
- [ ] **Step 6: Коммит** `feat(mono): add webhook and daily reconcile`.

### Task 8: Классификация и эталонная сверка

**Files:**
- Create: `apps/api/src/domain/classify.ts`, `domain/merchants.ts`, `transactions/reclassify.service.ts`, `scripts/golden-classify.ts`, `scripts/golden-import.ts`
- Test: `apps/api/src/domain/classify.test.ts`, `scripts/golden-mapping.test.ts`

**Interfaces:**
- Produces: `TxType = 'income'|'spend'|'obligation'|'tax'|'debt_payment'|'loan_in'|'own_transfer'|'person_transfer'|'person_in'|'cash_in'|'cash_out'|'goal_contribution'`; `classify(tx: ClassifyInput, ctx: ClassifyContext): {type: TxType; category: string; source: 'rule'|'owner'|'auto'; needsLabel: boolean}`; `Category` включает `uncategorized`

- [ ] **Step 1: Написать падающие тесты `classify`** на обезличенных примерах:
  - правило владельца главнее всего;
  - перевод между своими картами и банками даёт `own_transfer`;
  - поступление на счёт `fop` даёт `income`, а `ФОП → карта` даёт `own_transfer`;
  - платёж со счёта `fop` на получателя ГУ ДПС даёт `tax`;
  - «Кредит до завтра», МФО и «рассрочка на карту» при поступлении дают `loan_in`, при списании `debt_payment`;
  - банкомат даёт `cash_out`, пополнение наличными `cash_in`;
  - положительная сумма с MCC покупки даёт `spend` с положительной суммой, это возврат;
  - неизвестный получатель перевода даёт `person_transfer` и `needsLabel: true`;
  - неизвестный продавец с MCC 5812 даёт категорию кафе, без MCC даёт `uncategorized`.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Порядок по §5.5. Тексты банка собрать из колонки `details` файла `transactions.csv`, в код попадают только шаблоны банка и известных сетей, а не имена людей.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Написать `golden-classify.ts`.** Читает `private/transactions.csv`, поля и соответствие групп:

| `group` отчёта | Допустимые типы |
|---|---|
| Доход | `income`, `cash_in`, `person_in`, `own_transfer` (вывод с ФОП), `spend` (возврат) |
| Расходы | `spend`, `tax`, `cash_out`, `obligation` |
| Долги | `debt_payment` |
| Займы | `loan_in` |
| Переводы | `person_transfer`, `obligation` |
| Свои счета | `own_transfer`, `goal_contribution` |

Печатает совпадение по сумме и список крупнейших расхождений без имён получателей. Код выхода 1 при совпадении ниже 95%. В CI скрипт пропускается, если файла нет.

- [ ] **Step 6: Написать `golden-import.ts`.** За 1 января – 29 октября 2026, счета `black` и `white`, суммирует операции БД через то же соответствие и сравнивает с итогами 1,370,155, 863,793, 488,751, 244,931 и 484,553 гривен. Выводит таблицу расхождений, а итоговую оценку делает человек.
- [ ] **Step 7: Запустить на реальных данных.** Ожидается: `golden-classify` не ниже 95%, расхождения `golden-import` объяснены и записаны в `docs/superpowers/golden-notes.md` без личных данных.
- [ ] **Step 8: Коммит** `feat(domain): classify transactions and add golden checks`.

### Task 9: Плановые данные и сопоставление платежей

**Files:**
- Create: `apps/api/src/plan/*`, `domain/recurring-match.ts`, `scripts/seed-private.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/api/src/domain/recurring-match.test.ts`, `apps/api/test/plan.e2e.test.ts`

**Interfaces:**
- Consumes: `classify`, таблицы Task 3
- Produces: CRUD `/plan/expected-incomes`, `/plan/payments`, `/plan/loans`, `/plan/manual-balances`, `/settings`; `POST /plan/incomes/:eventId/confirm`, `POST /plan/incomes/:eventId/date`, `POST /plan/payments/:id/mark-paid`; `matchPayment(tx, payments): Payment | null`; `monthlyEvents(expected, today): IncomeEvent[]`

- [ ] **Step 1: Написать падающие тесты:**
  - `matchPayment`: списание ₴5,295 рядом с 18 ноября находит skay.ua, допуск ±3 дня и точная сумма либо `match_hint`, повторно уже оплаченный платёж не находит;
  - перевод $800 по метке «обязательное» закрывает платёж месяца и не считается тратой;
  - ручной займ сразу создаёт запись `loans` и плохой случай, а поступление `loan_in` создаёт займ автоматически;
  - `monthlyEvents` создаёт по одному событию на источник в месяц с датой по умолчанию 25 число;
  - подтверждение USDC добавляет сумму в `manual_balances` Binance, повтор идемпотентен;
  - сопоставление поступления с USDC уменьшает `manual_balances` и не создаёт `income`.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** `seed-private.ts` читает `private/seed.json` с данными §2 (рассрочки, квартплата, $800, налоги, настройки: `lifestyle_cap` 10,000,000 копеек, `food_floor` 45,000, `tax_rate_bp` 600, `esv_quarter` 570,702). Схемы Zod лежат в `packages/contracts`.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(plan): add planned payments, incomes and matching`.

### Task 10: Движок денег

**Files:**
- Create: `apps/api/src/domain/money.ts`, `tax.ts`, `daily.ts`, `run-out.ts`
- Test: `apps/api/src/domain/money.test.ts`, `tax.test.ts`, `daily.test.ts`, `run-out.test.ts`

**Interfaces:**

```ts
type Minor = number; // целые копейки
ownMoney(account: {balance: Minor; creditLimit: Minor}): Minor
toUah(amount: Minor, currency: number, rates: Rates): {uah: Minor; stale: boolean}
taxReserve(i: {fopIncomeQuarter: Minor; rateBp: number; esvQuarter: Minor;
  dayOfQuarter: number; daysInQuarter: number; paidThisQuarter: Minor; unpaidScheduled: Minor}): Minor
sumDue(payments, today: string, nextIncomeOn: string | null): Minor  // today ≤ due < nextIncomeOn
computeDaily(i: DailyInput): DailyState
runOutDate(i: {free: Minor; avgDailySpend: Minor; today: string}): string | null

interface DailyInput {
  today: string; cardsMoney: Minor; fopMoney: Minor; binanceMoney: Minor; creditAvailable: Minor;
  taxReserve: Minor; obligationsDue: Minor; goalDue: Minor; borrowed: Minor;
  nextIncomeOn: string | null; spentToday: Minor; lifestyleCapMonthly: Minor; foodFloor: Minor;
  bridgeDaily: Minor | null; creditPlan: Minor | null;
}
interface DailyState {
  mode: 'normal' | 'bridge'; daysLeft: number; free: Minor; dailyLimit: Minor; leftToday: Minor;
  level: number; needsIncomeDate: boolean;
  bridge: null | { creditNeeded: Minor; recommendedDaily: Minor; maxDailyWithinCredit: Minor;
                   shortfall: Minor; overPlan: boolean };
}
```

- [ ] **Step 1: Написать падающие тесты с точными значениями из §5.3**, `today` 2026-11-02, `nextIncomeOn` 2026-11-20, значит `daysLeft` 18:
  - свои 1,032,500, обязательные 2,229,500, налог 0: `free` −1,197,000; при `bridgeDaily` 45,000 `creditNeeded` 2,007,000; при 100,000 `creditNeeded` 2,997,000;
  - с `taxReserve` 794,634: `free` −1,991,634; при 45,000 `creditNeeded` 2,801,634, `shortfall` 0; при 100,000 `creditNeeded` 3,791,634, `shortfall` 791,634 при `creditAvailable` 3,000,000;
  - там же `recommendedDaily` 45,000 и `maxDailyWithinCredit` 56,020. Рекомендация это порог `foodFloor`, если он укладывается в кредит: брать весь кредит приложение не советует;
  - если даже `foodFloor` не укладывается, `recommendedDaily` равен `foodFloor`, а `shortfall` больше 0;
  - `sumDue`: платёж 18 ноября входит при доходе 20 ноября, а платёж 20 ноября нет;
  - `taxReserve`: налоговая база 22,393,160 при 600 б.п. даёт 1,343,590; ЕСВ 570,702 за 33 из 92 дней даёт начисление 204,708; `unpaidScheduled` складывается, уплаченное вычитается, результат не ниже 0.
- [ ] **Step 2: Добавить тесты нормального режима:** `free` 30,000,000, 30 дней, потолок 10,000,000 в месяц: `dailyLimit` 333,333; `free` 900,000, 30 дней: `dailyLimit` 30,000; `leftToday` может быть отрицательным; `level` всегда от 0 до 1 и равен 0 при `dailyLimit` 0; `free` ровно 0 это `normal`, а не мост; `overPlan` true, только когда сумма своих денег ниже `−creditPlan`.
- [ ] **Step 3: Добавить тесты Review Focus:**
  - (3) операции в 23:59 и 00:01 по Киеву относятся к разным `local_date`, в ночь 25 октября 2026 расчёт `daysLeft` верен;
  - (4) счёт 840 пересчитывается по курсу, при старом курсе `stale: true`, при отсутствии курса бросается ошибка;
  - (5) `ownMoney` с `balance` 3,000,000 и `creditLimit` 3,000,000 даёт 0, снижение `creditLimit` до 2,000,000 даёт 1,000,000; `nextIncomeOn` null даёт `needsIncomeDate: true` и `daysLeft` 30.
- [ ] **Step 4: Запустить**, ожидается FAIL.
- [ ] **Step 5: Реализовать.** Формулы по §5.1–§5.3. Лимит на день делится с округлением вниз, в пользу осторожности, а `taxReserve` и `toUah` округляются до ближайшей копейки. При `mode: 'bridge'` и `bridgeDaily` null `dailyLimit` равен `recommendedDaily`. `runOutDate` возвращает null, если `avgDailySpend` 0.
- [ ] **Step 6: Запустить**, ожидается PASS. Покрытие `domain/` не ниже 95% строк.
- [ ] **Step 7: Коммит** `feat(domain): add daily limit, bridge and tax engine`.

### Task 11: Эндпоинт «Сегодня»

**Files:**
- Create: `apps/api/src/today/today.service.ts`, `today.controller.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/api/test/today.e2e.test.ts`

**Interfaces:**
- Consumes: `computeDaily`, `taxReserve`, `sumDue`, `runOutDate`, `toUah`
- Produces: `GET /today -> TodayDto`, `POST /bridge {dailyAmount} -> TodayDto`, `POST /bridge/preview {dailyAmount} -> BridgePreviewDto`

```ts
interface TodayDto {
  date: string; state: DailyState; usdRate: number; rateStale: boolean;
  accounts: { own: Minor; credit: Minor; fop: Minor; binance: Minor };
  upcoming: { id: string; name: string; amount: Minor; dueOn: string; kind: string }[];
  questions: { id: string; kind: 'usdc_arrived' | 'income_date' | 'recipient_label'; text: string }[];
  badCases: { id: string; text: string }[];
  runOutOn: string | null; syncedAt: string; syncStale: boolean; limitVisual: 'mercury' | 'ring';
}
interface BridgePreviewDto { dailyAmount: Minor; creditNeeded: Minor; shortfall: Minor }
```

- [ ] **Step 1: Написать падающие тесты:** два запроса за день отдают один `dailyLimit`, даже если между ними пришла трата, а `leftToday` уменьшается; на следующий день снимок новый и перерасход распределён; траты считаются только по типу `spend` с возвратами, а `obligation`, `tax`, `debt_payment`, `own_transfer` не считаются; `person_transfer` считается тратой по меткам «общий бюджет», «помощь», «разово»; `cash_out` считается тратой; поступивший займ увеличивает `borrowed`, поэтому `free` не растёт; `POST /bridge` сохраняет выбор, а `credit_plan` не меняется при обычной трате и меняется при изменении платежей или даты дохода; режим закрывается при `free ≥ 0`; `preview` ничего не сохраняет; при последней успешной синхронизации старше 6 часов `syncStale: true`, расчёт при этом работает (Review Focus 2).
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Сервис собирает ввод из БД и вызывает чистые функции, сам ничего не считает, кроме выборок. `goalDue` пока равен 0: цели появятся в следующем плане. `avgDailySpend` берётся за последние 7 дней. Снимок пишется в `daily_snapshots` при первом запросе дня и задачей в 00:05 по Киеву.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(today): add today endpoint and bridge plan`.

### Task 12: Операции и метки

**Files:**
- Create: `apps/api/src/transactions/transactions.controller.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/api/test/transactions.e2e.test.ts`

**Interfaces:**
- Consumes: `classify`, `matchPayment`, `toUah`
- Produces: `GET /transactions?cursor&type`, `PATCH /transactions/:id {type?, category?, applyToSimilar: boolean}`, `POST /recipients/label {counterKey, label}`

- [ ] **Step 1: Написать падающие тесты:** страницы без пропусков при новых вставках; смена типа с `applyToSimilar` создаёт правило и меняет похожие прошлые операции, а `type_source: 'owner'` больше не перезаписывается сверкой; метка получателя применяется ко всей истории и убирает вопрос; ответ не содержит IBAN и `raw`; операция в USD содержит `amount_uah` и курс на дату операции, который не меняется при обновлении курсов.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(transactions): add edit, rules and recipient labels`.

### Task 13: Уведомления

**Files:**
- Create: `apps/api/src/notifications/notifications.service.ts`, `schedule.ts`, `expo-push.ts`
- Test: `apps/api/src/notifications/schedule.test.ts`

**Interfaces:**
- Consumes: `TodayService`, таблица `scheduled_payments`
- Produces: `POST /devices/push-token`, `dueNotifications(state, now): Notification[]`, где `Notification = {key: string; kind: 'tax'|'over_limit'|'bad_case'|'usdc'|'income_date'|'sync_broken'; title: string; body: string}`

- [ ] **Step 1: Написать падающие тесты на фейковых часах:**
  - платёж со сроком 20 ноября даёт напоминания 13, 19 и 20 ноября в 10:00, уплаченный не даёт ни одного, уплата после первого отменяет остальные;
  - перерасход даёт одно уведомление в 21:00 и ничего без него;
  - не больше одного обычного уведомления в день, налоговые не считаются;
  - плохой случай приходит один раз по ключу, в режиме моста без выхода за план его нет;
  - вопрос про USDC приходит раз в день с 15 по 25 число, пока не подтверждён, в следующем месяце снова;
  - если вебхук и сверка не работают больше 24 часов, одно уведомление `sync_broken`;
  - текст не содержит слов-упрёков; содержит сумму и срок для налога.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** `dueNotifications` чистая функция, задача раз в 15 минут, дедупликация по `notifications_log.key`. Отправка через Expo Push. Сбой отправки не помечает как отправленное.
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(notifications): add tax, limit and income reminders`.

### Task 14: Прототип металла на iPhone

Это точка решения. Если эффект не тянет, дизайн пересматривается до Task 15.

**Files:**
- Create: `apps/mobile/` (Expo dev build, iOS only), `src/metal/metal.sksl.ts`, `Mercury.tsx`, `Ring.tsx`, `LimitVisual.tsx`, `level.ts`
- Test: `apps/mobile/src/metal/level.test.ts`

**Interfaces:**
- Consumes: `tokens`
- Produces: `<LimitVisual mode="mercury"|"ring" level={number} />`, `waveLevel(level: number, reducedMotion: boolean): number`

- [ ] **Step 1: Написать падающий тест `level`:** значение вне 0..1 ограничивается, NaN даёт 0, анимация перехода уровня плавная, при `reducedMotion` время шейдера не меняется.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Перенести шейдер из `docs/superpowers/mockups/liquid-metal.html` в SkSL. Ртуть по макету A, кольцо по макету C, одна функция поверхности. Рендер в половинном разрешении, пауза при уходе приложения в фон и при `reduceMotionEnabled`.
- [ ] **Step 4: Запустить тест**, ожидается PASS.
- [ ] **Step 5: Владелец проверяет на своём iPhone.** Критерии: не ниже 55 кадров в секунду в Xcode Instruments на 60 с, нагрев и расход батареи за 10 минут на экране без заметной разницы с обычным приложением, внешний вид сравнимый с макетом. Если не проходит: снизить разрешение и частоту до 30 кадров, затем показать статичный металл с обновлением при изменении уровня. Результат записать в `docs/superpowers/metal-notes.md`.
- [ ] **Step 6: Коммит** `feat(mobile): add liquid metal limit visual`.

### Task 15: Приложение: вход, «Сегодня», мост

**Files:**
- Create: `apps/mobile/src/api/client.ts`, `api/queries.ts`, `format.ts`, `screens/Login.tsx`, `Today.tsx`, `components/{BridgePlan,AccountsList,Upcoming,QuestionCard,BadCaseCard,StaleBanner}.tsx`
- Test: `apps/mobile/src/screens/Today.test.tsx`, `src/format.test.ts`

**Interfaces:**
- Consumes: `TodayDto`, `BridgePreviewDto` из `packages/contracts`, `LimitVisual`, `tokens`
- Produces: навигация с вкладками «Сегодня», «Операции», «Настройки»

- [ ] **Step 1: Написать падающие тесты:**
  - `formatMoney(1032500)` даёт `₴10,325`, отрицательные со знаком `−`, рядом доллары по курсу;
  - нормальный режим: «Сегодня можно», `leftToday`, «из X на день», счета, ближайшие платежи;
  - `credit` подписан «Кредитные» и не складывается со «Свои»;
  - мост: показан план и ползунок; изменение вызывает `preview` с задержкой и показывает `creditNeeded`; `shortfall > 0` показывает, сколько не хватает, и не показывает кнопку подтверждения плана;
  - отрицательный `leftToday` показан без красного и без упрёка, металл на нуле;
  - вопросы USDC и даты дохода: одно нажатие вызывает API и убирает карточку;
  - **нет сети и `syncStale`: последние данные на экране и пометка времени обновления, лимит не обнуляется** (Review Focus 2);
  - первая загрузка: скелет той же геометрии, ошибка входа: понятный текст;
  - размеры нажимаемых элементов не меньше `tokens.touchMin`.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.** Токен в SecureStore, TanStack Query с сохранением последнего ответа на устройстве, обновление при открытии приложения. Текст поверх металла на `surface.glass`. Без рамок. Ползунок плавный, отправка после остановки.
- [ ] **Step 4: Запустить**, ожидается PASS, а также `pnpm check:colors`.
- [ ] **Step 5: Проверить на симуляторе** оба режима данных через тестовый сервер, снять скриншоты.
- [ ] **Step 6: Коммит** `feat(mobile): add login, today and bridge screens`.

### Task 16: Операции и настройки

**Files:**
- Create: `apps/mobile/src/screens/Activity.tsx`, `Settings.tsx`, `components/{TxRow,TxEditSheet,RecipientLabelSheet,TaxPayments}.tsx`
- Test: `apps/mobile/src/screens/Activity.test.tsx`, `Settings.test.tsx`

**Interfaces:**
- Consumes: `/transactions`, `/recipients/label`, `/settings`, `/plan/*`, `/bridge`, `POST /devices/push-token`

- [ ] **Step 1: Написать падающие тесты:**
  - смена типа или категории в одно нажатие, переключатель «применить к похожим» включён по умолчанию;
  - новый получатель: вопрос «Кто это?» с вариантами общий бюджет, помощь, возврат долга, разово, обязательное;
  - настройки: ползунок `lifestyle_cap` показывает, сколько останется до следующего дохода (сдвиг дат целей появится в плане целей);
  - переключатель «Ртуть» и «Кольцо» сразу меняет экран «Сегодня»;
  - список налоговых платежей: сумма, срок, отметка об уплате, добавление платежа нового квартала;
  - ручной займ создаётся из настроек, после чего на «Сегодня» появляется плохой случай;
  - при ошибке сохранения значение возвращается и показан текст;
  - разрешение на уведомления запрашивается один раз, отказ не ломает приложение.
- [ ] **Step 2: Запустить**, ожидается FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить**, ожидается PASS.
- [ ] **Step 5: Коммит** `feat(mobile): add activity, labels and settings`.

### Task 17: Запуск на iPhone и проверка на реальных данных

**Files:**
- Create: `apps/mobile/eas.json`, `docs/superpowers/launch-checklist.md`

- [ ] **Step 1: Собрать через EAS** и установить на iPhone владельца через TestFlight или внутреннюю сборку. Ожидается: приложение открывается и входит.
- [ ] **Step 2: Прогнать чек-лист на реальных данных:**
  - свои деньги совпадают с приложением monobank с точностью до `creditLimit`;
  - реальная покупка появляется меньше чем за минуту, `leftToday` и уровень металла падают;
  - лимит не меняется в течение дня, а завтра пересчитан;
  - мост на реальных цифрах ноября совпадает с ручным расчётом;
  - напоминание о налогах приходит и исчезает после уплаты;
  - перезапуск сервера не теряет данные, очередь продолжает работу;
  - бэкап восстанавливается;
  - при выключенном вебхуке сверка его восстанавливает.
- [ ] **Step 3: Владелец пользуется 7 дней** и записывает, чему не верит и что раздражает. Найденное становится задачами до начала плана целей.
- [ ] **Step 4: Коммит** `chore: add launch checklist and first build config`.
