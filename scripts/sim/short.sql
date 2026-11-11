-- On top of seed.sql: the money does not reach the income (a big payment before it), so the app is
-- in the shortage mode with no plan confirmed yet.
UPDATE scheduled_payments SET amount=4500000 WHERE name='Квартплата';
DELETE FROM bridge_plans;
DELETE FROM daily_snapshots WHERE local_date=(now() AT TIME ZONE 'Europe/Kyiv')::date;
SELECT name, amount FROM scheduled_payments ORDER BY id;
