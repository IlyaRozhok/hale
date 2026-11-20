// Accounts and money shaped like the owner's (Д2а): every bank account kind, a card with a credit limit, a dollar
// account, the cash wallet, Binance and a balance set aside, a payment and an income ahead, spending on every kind.
// The migration test fills a database at 0037 with it and checks that the limit, the reserve and own money read
// the same after 0038 as they did before it.
type Query = (sql: string, args?: unknown[]) => Promise<unknown>;

export async function fillOwnerAccounts(q: Query): Promise<void> {
  await q(
    `UPDATE settings SET lifestyle_cap=10000000, food_floor=45000, tax_rate_bp=600, esv_quarter=0, tracking_start='2026-11-01',
            cash_start='2026-11-01', cash_started_at='2026-10-31T22:00:00Z' WHERE id=1`,
  );
  await q(`INSERT INTO fx_rates (currency, fetched_at, rate) VALUES ('USD', '2026-11-10T09:00:00Z', 41.5)`);
  const accounts: [string, string, string, number, number][] = [
    ["black", "black", "UAH", 3_000_000, 3_000_000],
    ["white", "white", "UAH", 1_431_300, 0],
    ["white-usd", "white", "USD", 10_000, 0],
    ["fop", "fop", "UAH", 500_000, 0],
    ["jar", "jar", "UAH", 2_000_000, 0],
    ["platinum", "other", "UAH", 210_000, 0],
    ["iron", "other", "UAH", 900_000, 1_000_000],
    ["cash", "cash", "UAH", 0, 0],
  ];
  const ids: Record<string, number> = {};
  for (const [ext, kind, currency, balance, credit] of accounts) {
    const rows = (await q(
      `INSERT INTO accounts (external_id, kind, currency, balance, credit_limit) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ext, kind, currency, balance, credit],
    )) as { id: number }[];
    ids[ext] = rows[0]!.id;
  }
  let n = 0;
  const tx = (ext: string, amount: number, type: string, date: string) =>
    q(
      `INSERT INTO transactions (external_id, account_id, occurred_at, local_date, description, amount, amount_uah, type, raw)
       VALUES ($1,$2,$3,$4,'x',$5,$5,$6,'{}')`,
      [`t${++n}`, ids[ext], `${date}T10:00:00Z`, date, amount, type],
    );
  await tx("cash", 3_025_000, "income", "2026-11-01");
  for (const [ext, date] of [["white", "2026-11-07"], ["black", "2026-11-08"], ["platinum", "2026-11-09"], ["iron", "2026-11-10"], ["cash", "2026-11-10"], ["jar", "2026-11-10"]]) {
    await tx(ext!, -42_000, "spend", date!);
  }
  await q(`INSERT INTO manual_balances (name, amount, currency, counts_as_own) VALUES ('Binance', 12600, 'USD', true), ('SOL', 100500, 'USD', false)`);
  await q(`INSERT INTO scheduled_payments (kind, name, amount, currency, due_on) VALUES ('obligation', 'Аренда', 1500000, 'UAH', '2026-11-20')`);
  const income = (await q(
    `INSERT INTO expected_incomes (source, amount, currency, window_start_day, window_end_day) VALUES ('fop', 6000000, 'UAH', 25, 28) RETURNING id`,
  )) as { id: number }[];
  await q(`INSERT INTO income_events (expected_income_id, period, expected_on, status) VALUES ($1, '2026-11', '2026-11-25', 'expected')`, [income[0]!.id]);
}

/** The moment the comparison is read at: a Kyiv day after all the spending above. */
export const OWNER_ACCOUNTS_NOW = "2026-11-10T12:00:00Z";
