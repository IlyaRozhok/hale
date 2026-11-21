-- Invented data for the simulator stand. Every date is counted from today in Kyiv, so the picture
-- is the same on any day: income in 8 days, a ₴2,000 limit with ₴760 spent, a reserve of ₴5,000,
-- two payments before the income, a week within the limit, yesterday ₴340 left of ₴1,960.
CREATE OR REPLACE FUNCTION pg_temp.d(shift integer) RETURNS date
  AS $$ SELECT (now() AT TIME ZONE 'Europe/Kyiv')::date + shift $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.at(shift integer, hour integer) RETURNS timestamptz
  AS $$ SELECT ((pg_temp.d(shift) + make_time(hour, 0, 0)) AT TIME ZONE 'Europe/Kyiv') $$ LANGUAGE sql;

TRUNCATE jobs, rules, transactions, accounts, fx_rates, income_events, expected_incomes, scheduled_payments,
         recurring_payments, manual_balances, loans, bridge_plans, daily_snapshots, goals RESTART IDENTITY CASCADE;
UPDATE settings SET lifestyle_cap=6000000, food_floor=45000, tax_rate_bp=0, esv_quarter=0,
                    tracking_start=pg_temp.d(-40), last_sync_at=now(), last_contact_at=now(), cash_start=NULL;

INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ('sim-black','black','UAH',3764000,0);
INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', now(), 41.5);
INSERT INTO expected_incomes (source, name, pays_fop_tax, amount, currency, window_start_day, window_end_day) VALUES ('fop', 'ФОП', true, 9000000, 'UAH', 15, 25);
INSERT INTO income_events (expected_income_id, period, expected_on, status)
  VALUES (1, to_char(pg_temp.d(8), 'YYYY-MM'), pg_temp.d(8), 'expected');
INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES
  ('obligation','Квартплата',1700000,'UAH',pg_temp.d(4)),
  ('obligation','Интернет',40000,'UAH',pg_temp.d(2));
INSERT INTO daily_snapshots (local_date, daily_limit, mode) VALUES
  (pg_temp.d(-7),190000,'normal'),(pg_temp.d(-6),190000,'normal'),(pg_temp.d(-5),192000,'normal'),(pg_temp.d(-4),192000,'normal'),
  (pg_temp.d(-3),194000,'normal'),(pg_temp.d(-2),196000,'normal'),(pg_temp.d(-1),196000,'normal');
INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, needs_label, raw) VALUES
  ('s-1',1,pg_temp.at(0,8), pg_temp.d(0), 'Кофейня',-16000,-16000,'spend','cafe',false,'{}'),
  ('s-2',1,pg_temp.at(0,9), pg_temp.d(0), 'Сильпо',-60000,-60000,'spend','groceries',false,'{}'),
  ('s-3',1,pg_temp.at(-1,12),pg_temp.d(-1),'АТБ',-162000,-162000,'spend','groceries',false,'{}'),
  ('s-4',1,pg_temp.at(-2,12),pg_temp.d(-2),'Аптека',-120000,-120000,'spend','health',false,'{}'),
  ('s-5',1,pg_temp.at(-3,12),pg_temp.d(-3),'Сильпо',-180000,-180000,'spend','groceries',false,'{}'),
  ('s-6',1,pg_temp.at(-4,12),pg_temp.d(-4),'Кино',-90000,-90000,'spend','leisure',false,'{}'),
  ('s-7',1,pg_temp.at(-5,12),pg_temp.d(-5),'Такси',-150000,-150000,'spend','transport',false,'{}'),
  ('s-8',1,pg_temp.at(-6,12),pg_temp.d(-6),'Сильпо',-170000,-170000,'spend','groceries',false,'{}');
INSERT INTO goals (name, target_cents, saved_cents, sort) VALUES ('Подушка', 500000, 120000, 0);
SELECT count(*) AS transactions FROM transactions;
