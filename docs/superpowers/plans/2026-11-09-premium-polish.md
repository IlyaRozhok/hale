# Премиальная отделка: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** тихий «Сегодня» с тонкой металлической полосой и колокольчиком, меню как у PS5, строки операций со значками категорий, один зелёный акцент.

**Architecture:** только экраны и компоненты `apps/mobile` и токены. Сервер добавляет одно поле `paymentName` в `TransactionDto`. Цифры не пересчитываются: экран показывает те же значения из `TodayDto` и `TransactionDto`.

**Tech Stack:** Expo / React Native, Skia (металл), jest + RNTL; NestJS + vitest для поля.

**Spec:** `docs/superpowers/specs/2026-11-09-premium-polish-design.md`

## Global Constraints

- Цвета только через токены `packages/tokens`, контраст проверяет `contrast.test.ts`.
- Иконки Tabler outline путями в `components/Icon.tsx`, без новых зависимостей.
- Один акцент: шалфейный (`palette.sage`) через `color.accent.signal`; только поступления и цифра на колокольчике.
- Металл: маленький холст, медленно, стоит в фоне и при «Уменьшении движения».
- Тексты на русском. Ветка `feat/premium-polish`, слияние, деплой и сборка на iPhone только с согласия владельца.

## Review Focus

1. Лимит превышен или ноль: полоса пустая, заголовок «Сверх лимита» / текст «Лимит на сегодня использован» прежние.
2. Режим без лимита (`dailyLimit = 0`, bridge): полосы нет, строка «Нужен план до зарплаты» осталась и открывает окно.
3. Ошибка первой загрузки: настройки всё равно доступны (теперь из «Плана»), колокольчик без данных не падает.
4. Иностранная валюта и неизвестный курс в строке операции: подписи «$X» и «курс неизвестен» остаются.
5. Неизвестная категория или `type = null`: нейтральный значок, без падения.

---

### Task 1: Токен акцента и иконки

**Files:**
- Modify: `packages/tokens/src/semantic.ts`, `packages/tokens/src/contrast.test.ts`
- Modify: `apps/mobile/src/components/Icon.tsx`
- Create: `apps/mobile/src/categoryIcon.ts`, `apps/mobile/src/categoryIcon.test.ts`

**Interfaces:**
- Produces: `color.accent.signal` (= `p.sage`), `color.accent.fgOnSignal` (тёмный текст на зелёной метке); `IconName` получает `bell`, `cart`, `coffee`, `car`, `heart`, `bolt`, `phone`, `bag`, `ticket`, `repeat`, `receipt`, `cash`, `transfer`, `arrowIn`, `bank`, `circle`; `categoryIcon(tx: Pick<TransactionDto,"type"|"category"|"amount">): IconName`.

- [ ] Тест в `contrast.test.ts`: `accent.fgOnSignal` на `accent.signal` ≥ 4.5 и `accent.signal` на `surface.base` ≥ 3.
- [ ] Тест `categoryIcon`: `groceries→cart`, `cafe→coffee`, `transport→car`, `health→heart`, `utilities→bolt`, `telecom→phone`, `shopping→bag`, `leisure→ticket`, `subscriptions→repeat`, неизвестная категория `→circle`; типы: `cash_out/cash_in→cash`, `own_transfer→transfer`, `person_transfer/obligation/loan_out→transfer`, `income/person_in`→`arrowIn`, `tax/debt_payment→receipt`, `type=null→circle`.
- [ ] Запустить, увидеть падение; добавить токены, пути иконок Tabler и `categoryIcon`; зелёный.
- [ ] Коммит `feat: акцентный токен и значки категорий`.

### Task 2: `paymentName` у операции

**Files:**
- Modify: `packages/contracts/src/index.ts` (`TransactionDto.paymentName: string | null`)
- Modify: `apps/api/src/transactions/transactions.service.ts` (COLUMNS)
- Test: `apps/api/test/cash.e2e.test.ts` (describe «a planned payment paid with chosen operations»), `apps/api/test/transactions.e2e.test.ts` (список полей)

**Interfaces:** Produces `paymentName`: имя платежа из `payment_links` или `scheduled_payments.transaction_id`, иначе null.

- [ ] Тест: после `POST /cash/payments/:id/links` обе операции в `/transactions` имеют `paymentName: "Квартплата"`; строка оплаты из кошелька (`POST /cash/payments/:id`) тоже; обычная операция `null`. Список полей в transactions.e2e пополнить `paymentName`.
- [ ] Красный; добавить в COLUMNS `COALESCE((SELECT s.name FROM payment_links l JOIN scheduled_payments s ON s.id=l.payment_id WHERE l.transaction_id=t.id), (SELECT s.name FROM scheduled_payments s WHERE s.transaction_id=t.id LIMIT 1)) AS payment_name`; зелёный, весь API.
- [ ] `txFixture` в `apps/mobile/src/testing.tsx`: `paymentName: null`.
- [ ] Коммит `feat: название платежа у операции`.

### Task 3: Строка операции

**Files:** Modify `apps/mobile/src/components/TxRow.tsx`; Test `apps/mobile/src/screens/Activity.test.tsx` (новый describe «row»).

**Interfaces:** Consumes `categoryIcon`, `color.accent.signal`, `paymentName`.

- [ ] Тесты: у строки есть значок (`testID="tx-icon-cart"` для продуктов); сумма траты цветом `color.money.neutral`, поступления `color.accent.signal`; при `hold` подпись слева только категория, справа под суммой «в обработке»; при `paymentName: "Квартплата"` подпись «Квартплата»; иностранная валюта и «курс неизвестен» сохранены; «Ждёт ответа» сохранено.
- [ ] Красный; значок — круг `radius.full` 36 pt на `color.surface.raised` с иконкой `color.fg.muted` (для поступлений `accent.signal`); зелёный; весь jest.
- [ ] Коммит `feat(mobile): строка операции со значком категории`.

### Task 4: Меню как у PS5, настройки в «Плане»

**Files:** Modify `components/TabBar.tsx`, `screens/Plan.tsx`, `screens/Today.tsx` (убрать кнопку профиля и модалку); Test `components/TabBar.test.tsx`, `screens/Plan.test.tsx`, `screens/Today.test.tsx` (тесты «opens settings…» и «settings stay reachable…» переезжают в Plan.test).

- [ ] Тесты: активная вкладка показывает подпись текстом (`getByText("Сегодня")` у выбранной), невыбранные без текста; на «Плане» кнопка «Настройки» открывает настройки и закрывает; при ошибке загрузки «Плана» кнопка есть; на «Сегодня» кнопки «Настройки» нет.
- [ ] Красный; активная плашка растёт по ширине (`flex` 2 против 1) с `LayoutAnimation`-подобным переходом ≤ 250 мс через Reanimated `Layout`, при «Уменьшении движения» без анимации; зелёный.
- [ ] Коммит `feat(mobile): меню с подписью у активного раздела, настройки в «Плане»`.

### Task 5: «Сегодня»: полоса, колокольчик, тихая строка

**Files:**
- Create: `apps/mobile/src/metal/MetalBar.tsx` (Skia: `HalfResCanvas` + `MetalFill` в прямоугольнике ширины `level`, скруглённый; трек `color.data.track`); экспорт из `metal/index.ts`
- Modify: `metal/useMetalClock.ts` — параметр `speed` (по умолчанию 1); токен `metal.barSpeed = 0.25`, `metal.barHeight = 6`
- Modify: `screens/Today.tsx`
- Test: `screens/Today.test.tsx`

**Interfaces:** `MetalBar({ level: number }): JSX.Element` (заполняет ширину родителя; `testID="limit-bar"`, `accessibilityValue={{ now: Math.round(level*100), min: 0, max: 100 }}`).

- [ ] Тесты (`LimitVisual` и `MetalBar` замоканы как сейчас):
  - колокольчик `accessibilityLabel="Вопросы: 2"` при двух вопросах, нажатие открывает «Осталось разобрать»; без вопросов метка «Вопросы», окно показывает «Вопросов нет»;
  - строка «Потрачено ₴760 из ₴2,000» и «5 дней в лимите», нажатие открывает календарь; при серии 0 справа «Календарь»;
  - `limit-bar` с `now=62` при `level 0.62`; при `leftToday ≤ 0` значение 0 и прежние тексты «Сверх лимита» / «Лимит на сегодня использован. Завтра будет новый.»;
  - без лимита полосы нет, «Нужен план до зарплаты» есть и открывает окно;
  - нет плашек «Осталось разобрать: N», «Добавить цель», нет `LimitVisual mode="mercury"`;
  - старые тесты на эти плашки переписать на колокольчик и строку.
- [ ] Красный; реализовать; удалить из `Today` `ActionRow` серии, вопросов и «Добавить цель» (`GoalCards` остаются при наличии целей); зелёный; весь jest, `tsc`, eslint.
- [ ] Коммит `feat(mobile): «Сегодня» с металлической полосой и колокольчиком`.

### Task 6: Проверка и документы

- [ ] Локальный сервер и симулятор (как в status.md): «Сегодня» в лимите, сверх лимита, вопросы в колокольчике, меню, «Операции» со значками и «Квартплата», настройки из «Плана».
- [ ] `status.md` и роадмап; коммит.
- [ ] Спросить владельца о слиянии, деплое (поле `paymentName`) и сборке на iPhone.
