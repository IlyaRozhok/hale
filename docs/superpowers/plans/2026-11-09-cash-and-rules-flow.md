# План: флоу наличных и правил

Дизайн: `docs/superpowers/specs/2026-11-09-cash-and-rules-flow-design.md`. Ветка `feat/cash-rules-flow`. Каждый шаг: сначала падающий тест, потом код.

## Сервер

1. **Правило не перебивает снятие.**
   - `domain/classify.ts`: правило с типом не `cash_out` пропускается, если операция исходящая и по тексту банка или MCC это снятие. Юнит-тесты в `classify.test.ts`.
   - `TransactionsService.apply` при «Применить к похожим»: похожие строки с типом `cash_out` не меняются, если новый тип другой; сама выбранная строка меняется всегда.
   - `GET /transactions/:id/similar?type=` → `{ count }`: та же выборка, что у применения. e2e в `transactions.e2e`.
2. **Мои правила.**
   - `GET /rules` → список: id, вид совпадения, значение, направление, тип, категория, ответ о получателе, число операций (совпадают по правилу и имеют его тип).
   - `DELETE /rules/:id`: удалить правило; строки под ним получают `type_source = NULL` и сразу переклассифицируются (`ReclassifyService.reclassifyIds`, модуль импортирует `MonoModule`). 404 для неизвестного id.
3. **Миграция 0017** `CashAndRulesFlow`: `payment_links (payment_id, transaction_id UNIQUE)`, `transactions.cash_amount bigint NULL`, `cash_cards (counter_key text PK, withdraws boolean)`.
4. **Оплачено операциями.**
   - `GET /payments/:id/candidates`: исходящие `cash_out`, `person_transfer`, `own_transfer`, `obligation` не на счёте наличных, от срока − 7 дней до сегодня, |сумма| ≤ платежа, не привязанные ни через `payment_links`, ни через `scheduled_payments.transaction_id`.
   - `POST /payments/:id/paid { transactionIds }`: только кандидаты (иначе 422), 409 если уже оплачен. Строки: тип `obligation`, категория `transfer`, `type_source = 'owner'`; ссылки в `payment_links`; `paid_at` = время последней операции.
   - Перетипизация привязанной строки владельцем в не «оплачивающий» тип удаляет её ссылку.
5. **Своя карта другого банка.**
   - Подходит: исходящий `own_transfer` не на банке и не на кошельке, с даты старта, без встречной строки на другом счёте за 10 минут. Общий SQL в `cash/wallet.ts`.
   - Кошелёк: + `COALESCE(cash_amount, полная сумма если карта «да», иначе 0)` по подходящим строкам.
   - Вопрос на «Сегодня» `cash_card:<tx>`: подходит, `cash_amount` пуст, ответа для карты нет.
   - `POST /cash/cards/:txId { answer: yes|part|no, amount? }`: yes/part запоминают карту как «да», part ставит `cash_amount`; no запоминает «нет».
   - `PATCH /cash/withdrawals/:txId { amount }`: сумма снятия этой операции, 0 = не снимал.
   - `TransactionDto.cashOut`: null, если операция не подходит; иначе сколько снято (0, если нет).

## iPhone

6. `TxEditSheet`: под «Применить к похожим» «Изменится N операций» (запрос `similar`).
7. Настройки → «Мои правила»: список, «Удалить» с подтверждением, после удаления сбрасываются кэши операций и «Сегодня».
8. `PaymentPaidSheet`: «Чем оплачено» со списком кандидатов, отметки, «Выбрано ₴X из ₴Y»; с отметками «Оплачено» шлёт `paid`, без — как раньше.
9. `QuestionCard` `cash_card`: «Да», «Да, часть» (поле суммы), «Нет». Карточка операции с `cashOut != null`: «Снял наличными: ₴X», изменить сумму или «Не снимал».

## Проверка

10. Симулятор на локальном сервере с засеянной базой: сценарий квартплаты 8.11 целиком.
11. `status.md`, роадмап.
