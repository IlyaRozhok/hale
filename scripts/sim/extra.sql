-- On top of seed.sql: what the first-day checks needed and the base picture lacks. An open loan
-- entered by hand (it must not show on Today, and can be repaid or removed in Plan → Займы), a FOP
-- account (the middle line of «Деньги» in Plan), and café spending older than a week and older than
-- a month (the «Месяц» period and the category filter in «Операции»).
INSERT INTO loans (amount, received_on, note) VALUES (500000, (now() AT TIME ZONE 'Europe/Kyiv')::date - 9, 'Друг');
INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ('sim-fop','fop','UAH',1200000,0);
INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, category, needs_label, raw) VALUES
  ('x-1',1,now() - interval '12 days',(now() AT TIME ZONE 'Europe/Kyiv')::date - 12,'Пицца',-42000,-42000,'spend','cafe',false,'{}'),
  ('x-2',1,now() - interval '20 days',(now() AT TIME ZONE 'Europe/Kyiv')::date - 20,'Кофейня',-18000,-18000,'spend','cafe',false,'{}'),
  ('x-3',1,now() - interval '26 days',(now() AT TIME ZONE 'Europe/Kyiv')::date - 26,'Сильпо',-95000,-95000,'spend','groceries',false,'{}'),
  ('x-4',1,now() - interval '34 days',(now() AT TIME ZONE 'Europe/Kyiv')::date - 34,'Ресторан',-130000,-130000,'spend','cafe',false,'{}');
SELECT (SELECT count(*) FROM loans) AS loans, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM transactions) AS transactions;
