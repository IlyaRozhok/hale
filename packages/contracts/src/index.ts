import { z } from "zod";

/** Whole minor units (kopecks, cents). */
export const money = z.number().int().refine(Number.isSafeInteger, "not a safe integer");
export const currency = z.string().regex(/^[A-Z]{3}$/);

/** A real calendar date, YYYY-MM-DD. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "not a real date");

const day = z.number().int().min(1).max(31);
const partial = <T extends z.ZodRawShape>(shape: z.ZodObject<T>) => shape.partial().strict();

// --- expected incomes -------------------------------------------------------
/** The kind an income had before Д3а, kept for an older app: `fop` pays the fop tax, `usdc` comes in crypto. */
export const incomeSource = z.enum(["fop", "usdc"]);
/** «Раз в месяц», «Два раза в месяц», «Без расписания». */
export const incomeSchedule = z.enum(["monthly", "twice", "none"]);
/** The account an income comes to, as `GET /today` names its rows: a bank or a manual account by id, or the cash wallet. */
export const incomeAccount = z.discriminatedUnion("source", [
  z.object({ source: z.literal("account"), id: z.number().int().positive() }).strict(),
  z.object({ source: z.literal("manual"), id: z.number().int().positive() }).strict(),
  z.object({ source: z.literal("cash") }).strict(),
]);
export type IncomeSchedule = z.infer<typeof incomeSchedule>;
export type IncomeAccount = z.infer<typeof incomeAccount>;
const incomeShape = z.object({
  /** An older app sends only this: the name and the flags follow from it. */
  source: incomeSource,
  name: z.string().trim().min(1).max(60),
  amount: money.positive(),
  currency,
  /** The window of the month's (first) payment. Not needed without a schedule. */
  window_start_day: day,
  window_end_day: day,
  schedule: incomeSchedule,
  /** The day of the second payment, for `twice` only. */
  second_day: day.nullable(),
  /** «С этого дохода платится налог ФОП». */
  pays_fop_tax: z.boolean(),
  /** «Приходит в крипте — спросить о выводе». */
  crypto: z.boolean(),
  account: incomeAccount.nullable(),
});
/**
 * A new income: by its name (Д3а), or by its old kind alone, as an older app sends it. What only the whole income can
 * tell (the second day of a twice-monthly one, the fop tax with two payments a month) the server checks, on a change too.
 */
export const expectedIncomeInput = incomeShape
  .partial()
  .required({ amount: true, currency: true })
  .strict()
  .refine((v) => v.source !== undefined || v.name !== undefined, "an income needs a name")
  .refine(
    (v) => v.schedule === "none" || (v.window_start_day !== undefined && v.window_end_day !== undefined),
    "an income with a schedule needs its days",
  )
  .refine(
    (v) => v.window_start_day === undefined || v.window_end_day === undefined || v.window_start_day <= v.window_end_day,
    "window start is after its end",
  );
export const expectedIncomePatch = partial(incomeShape);
export type ExpectedIncomeInput = z.infer<typeof expectedIncomeInput>;
export type ExpectedIncomePatch = z.infer<typeof expectedIncomePatch>;

export interface ExpectedIncomeDto {
  id: number;
  /** null for an income that neither pays the fop tax nor comes in crypto (Д3а). */
  source: "fop" | "usdc" | null;
  amount: number;
  currency: string;
  window_start_day: number;
  window_end_day: number;
  /** The fields below are absent from a server older than Д3а. */
  name?: string;
  schedule?: IncomeSchedule;
  second_day?: number | null;
  pays_fop_tax?: boolean;
  crypto?: boolean;
  account?: IncomeAccount | null;
}

export interface IncomeEventDto {
  id: number;
  expected_income_id: number;
  period: string;
  expected_on: string;
  status: string;
  /** 2 for the second payment of a twice-monthly income, else 1. Absent from a server older than Д3а. */
  slot?: number;
}

export const incomeDateInput = z.object({ date: isoDate }).strict();
/**
 * «Пришло на Binance»: `amount` is what actually arrived, in the income's minor units (cents for USDC).
 * Without it the expected amount is taken, as an older app sends it. The bound is $1,000,000,000 in cents.
 */
export const confirmIncomeInput = z.object({ amount: money.positive().max(100_000_000_000).optional() }).strict();
export type ConfirmIncomeInput = z.infer<typeof confirmIncomeInput>;
export const matchTransactionInput = z
  .object({ transactionId: z.number().int().positive() })
  .strict();

// --- scheduled payments -----------------------------------------------------
export const paymentKind = z.enum(["obligation", "installment", "tax"]);
const paymentShape = {
  kind: paymentKind,
  name: z.string().min(1).max(200),
  amount: money.positive(),
  currency,
  due_on: isoDate,
  match_hint: z.string().min(1).max(200).nullable(),
  overpayment: z.boolean(),
  /** The quarter a tax payment is for, "2026-Q4". */
  tax_quarter: z.string().regex(/^\d{4}-Q[1-4]$/).nullable(),
};
const paymentOptionals = {
  match_hint: paymentShape.match_hint.optional(),
  overpayment: paymentShape.overpayment.optional(),
  tax_quarter: paymentShape.tax_quarter.optional(),
};
export const scheduledPaymentInput = z.object({ ...paymentShape, ...paymentOptionals }).strict();
export const scheduledPaymentPatch = partial(z.object(paymentShape));
export type ScheduledPaymentInput = z.infer<typeof scheduledPaymentInput>;
export type ScheduledPaymentPatch = z.infer<typeof scheduledPaymentPatch>;

// --- recurring payments -----------------------------------------------------
const recurringShape = {
  kind: paymentKind,
  name: z.string().min(1).max(200),
  amount: money.positive(),
  currency,
  day_of_month: day,
  match_hint: z.string().min(1).max(200).nullable(),
  active: z.boolean(),
};
export const recurringInput = z
  .object({ ...recurringShape, kind: paymentKind.optional(), match_hint: recurringShape.match_hint.optional(), active: z.boolean().optional() })
  .strict();
export const recurringPatch = partial(z.object(recurringShape));
export type RecurringInput = z.infer<typeof recurringInput>;
export type RecurringPatch = z.infer<typeof recurringPatch>;

export interface RecurringDto {
  id: number;
  kind: "obligation" | "installment" | "tax";
  name: string;
  amount: number;
  currency: string;
  day_of_month: number;
  active: boolean;
}

// --- installments -----------------------------------------------------------
/** A series of equal monthly payments, known by its name. */
export const installmentInput = z
  .object({
    name: paymentShape.name,
    amount: money.positive(),
    currency,
    remaining: z.number().int().min(1).max(120),
    first_due: isoDate,
  })
  .strict();
export const installmentPatch = partial(z.object({ name: paymentShape.name, amount: money.positive(), currency }));
export type InstallmentInput = z.infer<typeof installmentInput>;
export type InstallmentPatch = z.infer<typeof installmentPatch>;

// --- loans ------------------------------------------------------------------
const loanShape = {
  amount: money.positive(),
  received_on: isoDate,
  note: z.string().max(500).nullable(),
  repaid_at: z.iso.datetime({ offset: true }).nullable(),
  /** «Вернуть до» (Б7); null clears it. */
  due_on: isoDate.nullable(),
};
export const loanInput = z
  .object({ amount: loanShape.amount, received_on: loanShape.received_on, note: loanShape.note.optional() })
  .strict();
export const loanPatch = partial(z.object(loanShape));
export type LoanPatch = z.infer<typeof loanPatch>;
export type LoanInput = z.infer<typeof loanInput>;
export const loanRepayInput = z.object({ amount: money.positive(), date: isoDate }).strict();
export type LoanRepayInput = z.infer<typeof loanRepayInput>;

export interface LoanRowDto {
  id: number;
  amount: number;
  /** What is still owed. */
  remaining: number;
  receivedOn: string;
  /** Set once the loan is fully repaid. */
  repaidOn: string | null;
  /** False when the owner only knows it was repaid: repaidOn is then the day that was said. */
  repaidDateKnown: boolean;
  repaidAmount: number;
  /** Paid on this loan beyond its principal. */
  serviceCost: number;
  /** The owner's note, or the bank's text for a loan from a bank row. */
  title: string | null;
  /** Entered by hand. */
  manual: boolean;
  /**
   * Can be deleted: entered by hand, or from a bank row that is no longer a loan (Б48). Absent on an older server,
   * where only a manual loan can be.
   */
  removable?: boolean;
  /** «Вернуть до» (Б7): null when not set. Absent on an older server. */
  dueOn?: string | null;
}

export interface LoanHistoryDto {
  stats: {
    borrowed: number;
    repaid: number;
    /** Interest, penalties, fees and payments beyond the principal. */
    serviceCost: number;
    /** Still owed on loans inside the tracked period. */
    stillOpen: number;
  };
  open: LoanRowDto[];
  /** Taken before tracking began with no repayment on record: not in the limit. */
  old: LoanRowDto[];
  repaid: LoanRowDto[];
}

// --- goals ------------------------------------------------------------------
const goalShape = {
  name: z.string().trim().min(1).max(100),
  target_cents: money.positive(),
  saved_cents: money.nonnegative(),
  sort: z.number().int().min(0).max(1_000_000),
};
export const goalInput = z
  .object({ name: goalShape.name, target_cents: goalShape.target_cents, saved_cents: goalShape.saved_cents.optional(), sort: goalShape.sort.optional() })
  .strict();
export const goalPatch = partial(z.object(goalShape));
export type GoalInput = z.infer<typeof goalInput>;
export type GoalPatch = z.infer<typeof goalPatch>;

export interface GoalDto {
  id: number;
  name: string;
  /** US cents. */
  target_cents: number;
  /** US cents. */
  saved_cents: number;
  sort: number;
}

// --- manual balances --------------------------------------------------------
/**
 * Currencies a balance kept by hand may be in (Д2а): the ones the server turns into hryvnias, the rates monobank gives
 * (CURRENCY_ALPHA on the server). A balance whose rate is missing counts as 0 and marks the rate stale.
 */
export const MANUAL_BALANCE_CURRENCIES = ["UAH", "USD", "EUR", "GBP", "PLN", "CHF", "CZK"] as const;
const balanceShape = {
  name: z.string().min(1).max(100),
  amount: money,
  currency: z.enum(MANUAL_BALANCE_CURRENCIES),
  counts_as_own: z.boolean(),
};
export const manualBalanceInput = z
  .object({ ...balanceShape, counts_as_own: balanceShape.counts_as_own.optional() })
  .strict();
export const manualBalancePatch = partial(z.object(balanceShape));
export type ManualBalanceInput = z.infer<typeof manualBalanceInput>;

// --- bank accounts (Д2а) -------------------------------------------------------
/**
 * The person's own mark on a bank account: whether its money is own money, and their name for it (null gives the
 * default name back). The cash wallet is always own money and is not changed here.
 */
export const accountPatch = partial(
  z.object({
    countsAsOwn: z.boolean(),
    name: z.string().trim().min(1).max(100).nullable(),
  }),
);
export type AccountPatch = z.infer<typeof accountPatch>;

export interface AccountDto {
  id: number;
  kind: "black" | "white" | "fop" | "jar" | "other";
  /** The person's name, or the default one. */
  name: string;
  countsAsOwn: boolean;
}

export interface ManualBalanceDto {
  id: number;
  name: string;
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  counts_as_own: boolean;
}

// --- settings ---------------------------------------------------------------
export const settingsPatch = partial(
  z.object({
    lifestyle_cap: money.nonnegative(),
    food_floor: money.nonnegative(),
    tax_rate_bp: z.number().int().min(0).max(10_000),
    esv_quarter: money.nonnegative(),
    limit_visual: z.enum(["mercury", "ring"]),
  }),
);
export type SettingsPatch = z.infer<typeof settingsPatch>;

export const settingsPreviewInput = z.object({ lifestyleCap: money.nonnegative() }).strict();
export type SettingsPreviewInput = z.infer<typeof settingsPreviewInput>;

/** What a lifestyle cap would mean, computed by the server. */
export interface SettingsPreviewDto {
  dailyLimit: number;
  /** Expected monthly income, minus tax on the FOP part, minus a third of the quarterly ESV, minus recurring payments and this month's installments, minus the cap; never below 0. */
  leftForGoalsMonthly: number;
  /** True when a foreign amount had no usable rate: the figure may be inaccurate. */
  rateStale: boolean;
}

export interface SettingsDto {
  lifestyle_cap: number;
  food_floor: number;
  tax_rate_bp: number;
  esv_quarter: number;
  limit_visual: "mercury" | "ring";
}

export interface ScheduledPaymentDto {
  id: number;
  kind: "obligation" | "installment" | "tax";
  name: string;
  amount: number;
  currency: string;
  due_on: string;
  paid_at: string | null;
  /** The monthly series this payment came from, if any. */
  recurring_id: number | null;
  tax_quarter: string | null;
  /** The app's own estimate for an ended quarter; replaced once the owner enters real figures. */
  is_estimate: boolean;
}

// --- private/seed.json ------------------------------------------------------
const seedPayment = z.object({ ...paymentShape, ...paymentOptionals, paid: z.boolean().optional() }).strict();
/** One monthly series of equal payments ending on `last_payment_on`, `remaining` payments long. */
const seedInstallment = z
  .object({
    name: z.string().min(1),
    amount: money.positive(),
    currency: currency.default("UAH"),
    remaining: z.number().int().min(1).max(120),
    last_payment_on: isoDate,
    overpayment: z.boolean().optional(),
    match_hint: z.string().min(1).optional(),
  })
  .strict();
export const seedFile = z
  .object({
    settings: settingsPatch.optional(),
    expected_incomes: z.array(expectedIncomeInput).default([]),
    installments: z.array(seedInstallment).default([]),
    recurring: z.array(recurringInput).default([]),
    payments: z.array(seedPayment).default([]),
    manual_balances: z.array(manualBalanceInput).default([]),
  })
  .strict();
export type SeedFile = z.infer<typeof seedFile>;
export type SeedPayment = z.infer<typeof seedPayment>;

// --- today ------------------------------------------------------------------
export const bridgeInput = z.object({ dailyAmount: money.positive() }).strict();
export type BridgeInput = z.infer<typeof bridgeInput>;

export interface BridgeStateDto {
  creditNeeded: number;
  recommendedDaily: number;
  maxDailyWithinCredit: number;
  shortfall: number;
  overPlan: boolean;
  /** True when the owner has an open, confirmed bridge plan. */
  confirmed: boolean;
}

export interface DailyStateDto {
  mode: "normal" | "bridge";
  daysLeft: number;
  free: number;
  dailyLimit: number;
  leftToday: number;
  /** 0..1 share of today's limit still unspent. */
  level: number;
  needsIncomeDate: boolean;
  bridge: BridgeStateDto | null;
  /**
   * Set only on the day the shortage mode came on: nothing on it is shown as going over the limit.
   * `nextLimit` is there while the day still runs on the limit it began with: the new one applies
   * from tomorrow. Without it the day's limit already is the new one. Absent on any other day and
   * from an older server.
   */
  shortageStart?: { nextLimit?: number };
}

/**
 * One place own money lies (task Б25). `own` is in kopecks and may be negative: a card's balance less
 * its credit limit. `creditLimit` is set on a card that has one. A balance kept by hand (`binance`,
 * `manual`) also carries its own currency and amount in that currency's minor units.
 * In `setAside` the same shape is a place money lies that is not own money; `own` is then its value in hryvnias.
 * `jar` and `other` (a monobank card of another type) come only from a newer server (Д2а).
 */
export interface OwnMoneyItemDto {
  kind: "black" | "white" | "fop" | "jar" | "other" | "cash" | "binance" | "manual";
  name: string;
  own: number;
  creditLimit?: number;
  currency?: string;
  amount?: number;
  /**
   * Where the row is kept, to open and change it (Д2а; absent from an older server): `account` is a bank account
   * (`PATCH /plan/accounts/:id`), `manual` a balance kept by hand (`/plan/manual-balances/:id`), `cash` the wallet.
   */
  source?: "account" | "manual" | "cash";
  /** The row's id in its source; absent for the wallet. */
  id?: number;
  /**
   * The person's mark (or the kind's default): whether the place counts as own money. Always false in `setAside`; in
   * `items` usually true, but a switched-off card in debt is there too with false, since its debt stays in own money.
   */
  countsAsOwn?: boolean;
}

export interface TodayDto {
  date: string;
  state: DailyStateDto;
  /** UAH per USD; 0 when no rate is known. */
  usdRate: number;
  rateStale: boolean;
  /** `cash` is the wallet, already inside `own`; 0 until the wallet is started. */
  /** `items` (newer servers) add up exactly to `own`; an older server leaves it out. */
  /**
   * `setAside` (Д2а; absent from an older server): the bank accounts and balances kept by hand the person keeps out
   * of own money, leaving out empty accounts as `items` does; not part of `own`.
   */
  accounts: {
    own: number;
    credit: number;
    fop: number;
    binance: number;
    cash: number;
    items?: OwnMoneyItemDto[];
    setAside?: OwnMoneyItemDto[];
  };
  /** `amount` in kopecks, already converted to hryvnias; `currency` is the payment's own. */
  upcoming: {
    id: string;
    name: string;
    amount: number;
    dueOn: string;
    kind: string;
    currency: string;
    /** Kopecks already paid by operations linked to this open payment (task Б9); absent from an older server. */
    paid?: number;
  }[];
  questions: {
    id: string;
    /** `payment_paid` (newer servers): id "payment_paid:<payment>:<operation>"; an older app shows it as a plain card. */
    kind: "usdc_arrived" | "usdc_match" | "income_date" | "recipient_label" | "cash_source" | "cash_card" | "payment_paid";
    text: string;
    /** Who a recipient question is about. */
    subject?: string;
    /** A second line under the text: for `payment_paid`, the operation and the payment's due date ("Іван П. · 12.11 · срок платежа 15.10"). */
    detail?: string;
    /** For `usdc_arrived`: the expected amount in the income's minor units (cents). Absent on an older server. */
    expectedAmount?: number;
  }[];
  badCases: {
    id: string;
    text: string;
    /** Set on a loan entered by hand, which the owner may remove; a loan from the bank has none. */
    removableLoanId?: number;
    /** Set on an open loan: it can be marked repaid. */
    repayLoan?: { id: number; remaining: number; receivedOn?: string };
  }[];
  /**
   * Open loans whose return date is today or past (Б7), the oldest date first; `amount` is what is still owed.
   * Absent on an older server.
   */
  loansDue?: { id: number; amount: number; dueOn: string }[];
  runOutOn: string | null;
  /** Last successful contact with the bank (webhook item, reconcile or balance refresh), null if there was none yet. */
  syncedAt: string | null;
  syncStale: boolean;
  limitVisual: "mercury" | "ring";
  /** Savings goals in US cents, in display order. */
  goals: { id: number; name: string; saved: number; target: number }[];
  /** Days within the limit in a row, back from yesterday. */
  streak: number;
  /**
   * Task А24: present only when at the current pace, above the limit, the free money runs out before the next known
   * income; absent otherwise (also when the usual day is within the limit), and from an older server.
   */
  pace?: PaceDto;
  /** The money day by day until the next income. Absent from a server older than the app. */
  runway?: RunwayDto;
  /**
   * Task Д4: whether the person has taxes — an income pays the fop tax, or a tax payment entered earlier is still unpaid.
   * False hides «Налоги» on «План». Absent from an older server: taxes are shown, as before.
   */
  taxes?: boolean;
}

/**
 * The pace of spending (task А24), in kopecks. The limit does not change with it.
 */
export interface PaceDto {
  /** The usual day: the average spent a day over the last 7 days, today left out. */
  avgDaily: number;
  /** The day the free money runs out at that pace: the same as `runOutOn`, always before `incomeOn`. */
  runOutOn: string;
  /** The next known income's day. */
  incomeOn: string;
  /**
   * A calm middle step: spending about `daily` a day (the middle of the limit and `avgDaily`, a whole ₴100), the same
   * free money lasts until `lastsUntil`, later than `runOutOn` and before `incomeOn`. `untilIncome` (task А24а2): about
   * this much a day from tomorrow lasts until the income — the free money without what is left of today's limit, over
   * the days after today before the income, rounded down to a whole ₴100; above 0 and below `daily`. Absent when there
   * is no such step, and when the income is tomorrow.
   */
  hint?: { daily: number; lastsUntil: string; untilIncome: number };
}

/** Own money without the tax reserve and debts, at the start of each day, if every day spends its limit. */
export interface RunwayDto {
  /** The last day drawn: the next income's day, or 30 days ahead when no income date is known. */
  endOn: string;
  incomeOn: string | null;
  /** What is left on `endOn`; negative when the money ends earlier. */
  reserve: number;
  /** The day the money ends: its spending or payment takes the balance below zero. */
  zeroOn: string | null;
  points: { date: string; balance: number }[];
  /** Unpaid payments inside the stretch, amounts in kopecks converted to hryvnias; an overdue one stands on today. `id` is the one in `upcoming`. */
  events: { id: string; date: string; name: string; amount: number }[];
}

// --- limit calendar ---------------------------------------------------------
export const calendarQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

export interface CalendarDayDto {
  date: string;
  /** The day's fixed limit; null when none was fixed, and on a past day on which the shortage mode came on. */
  limit: number | null;
  spent: number;
  status: "within" | "over" | "far_over" | "no_limit" | "today";
  /** The shortage mode came on that day: its spending is not judged. Absent otherwise and from an older server. */
  shortageStart?: true;
}

export interface CalendarDto {
  month: string;
  today: string;
  streak: number;
  /** The month's days up to today. */
  days: CalendarDayDto[];
}

export interface BridgePreviewDto {
  dailyAmount: number;
  creditNeeded: number;
  shortfall: number;
}

// --- transactions -----------------------------------------------------------
export const txType = z.enum([
  "income",
  "spend",
  "obligation",
  "tax",
  "debt_payment",
  "loan_in",
  "own_transfer",
  "person_transfer",
  "person_in",
  "cash_in",
  "cash_out",
  "goal_contribution",
  "loan_out",
]);
export type TxTypeDto = z.infer<typeof txType>;

export const transactionsQuery = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    type: txType.optional(),
    needsLabel: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    group: z.enum(["spend", "income", "all"]).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(64).optional(),
    /** Kyiv calendar days, both inclusive. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    /**
     * Task В6: only "true" — the rows that make up «желаемое» in «Итоги»: purchases in the limit on the «желаемое»
     * side. With a period, the summary's total is −`wanted` of «Итоги» for those days before «Итоги» clamp it at zero.
     */
    want: z.enum(["true"]).transform(() => true as const).optional(),
    /**
     * Task Д1: only the rows of the person's accounts of this kind (both currencies of a card). An older server
     * refuses it (400): the app sends it only when the page named `accountKinds`.
     */
    account: z.enum(["black", "white", "fop", "cash"]).optional(),
    /**
     * Task Я8: only "true" — the rows that make up «Платежи вне лимита» in «Итоги» (`otherPayments`): planned
     * payments, taxes and debt payments outside the limit. They add up in the summary and the day totals under every
     * group, «Траты» included, so with a period the summary's total is −`otherPayments` for those days. An older
     * server refuses it (400): the app sends it only when the page named it in `filters`.
     */
    other: z.enum(["true"]).transform(() => true as const).optional(),
    /**
     * Task Я8: every row of one place — the counterparty key (`counterKey`, a place's or a subscription's `key` in
     * «Итоги»), whatever type the row has now. An older server refuses it (400): sent only when `filters` names it.
     */
    place: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "from must not be after to");
export type TransactionsQuery = z.infer<typeof transactionsQuery>;
/** The kinds of account «Операции» can be narrowed to (task Д1). */
export type AccountFilterKind = NonNullable<TransactionsQuery["account"]>;
/** The filters of «Операции» a server names in `filters` because an older one refuses them (task Я8). */
export const TRANSACTION_FILTERS = ["other", "place"] as const;
export type TransactionFilterName = (typeof TRANSACTION_FILTERS)[number];

export const transactionPatch = z
  .object({
    type: txType.optional(),
    category: z.string().trim().min(1).max(64).optional(),
    /**
     * Task В6: «нужное» (false) or «желаемое» (true) for this one purchase; null gives it back to its category's side.
     * Only for a purchase in a category with a side (422 otherwise), checked after `type` and `category` apply. Never
     * with applyToSimilar: the choice is for one operation, a whole category moves in its own window.
     */
    want: z.boolean().nullable().optional(),
    applyToSimilar: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.type !== undefined || v.category !== undefined || v.want !== undefined, "type, category or want is required")
  .refine((v) => v.want === undefined || !v.applyToSimilar, { message: "want is for one operation, not with applyToSimilar", path: ["want"] });
export type TransactionPatch = z.infer<typeof transactionPatch>;

/** shared_budget, help and obligation are earlier answers: still understood, no longer offered. */
export const recipientLabelName = z.enum([
  "close_regular",
  "one_off",
  "service",
  "debt_repayment",
  "lend",
  "own_account",
  "skip",
  "shared_budget",
  "help",
  "obligation",
]);
export type RecipientLabelName = z.infer<typeof recipientLabelName>;
export const recipientLabelInput = z
  .object({ counterKey: z.string().regex(/^[0-9a-f]{16}$/), label: recipientLabelName })
  .strict();
export type RecipientLabelInput = z.infer<typeof recipientLabelInput>;
export const counterKeyParam = z.string().regex(/^[0-9a-f]{16}$/);

/** Everything sent to one recipient: what the question about them shows. */
export interface RecipientSummaryDto {
  name: string;
  count: number;
  total: number;
  lastOn: string;
  label: RecipientLabelName | null;
}

export interface TransactionDto {
  id: number;
  occurredAt: string;
  localDate: string;
  description: string;
  /** Signed minor units in the account currency. */
  amount: number;
  /** Signed kopecks at the rate of the operation date; null when no rate was known. */
  amountUah: number | null;
  fxRate: number | null;
  currency: string;
  type: TxTypeDto | null;
  category: string | null;
  hold: boolean;
  needsLabel: boolean;
  /** Stable opaque id of the counterparty; the IBAN itself is never returned. */
  counterKey: string;
  counterName: string | null;
  accountKind: string;
  /** Entered by hand on the cash wallet: it can be changed and deleted. */
  manual: boolean;
  /** The owner's answer about this recipient, if any. */
  recipientLabel: RecipientLabelName | null;
  /**
   * Set on a transfer to the owner's card at another bank since the wallet start: kopecks of it taken
   * out as cash there (0 when none or not answered yet). null on every other row.
   */
  cashOut: number | null;
  /** The planned payment this operation paid, if any: the list shows its name. */
  paymentName: string | null;
  /**
   * Kopecks of this spend paid from the credit limit; null when none or not known (rows before the server
   * kept the limit at the moment of the operation). Absent from an older server.
   */
  creditPart?: number | null;
  /**
   * Whether this row counts against the day limit (the «потрачено» of «Сегодня» and the calendar).
   * Absent from an older server.
   */
  inLimit?: boolean;
  /**
   * The answer to «Откуда наличные?» about a cash deposit since the wallet start, which the card can change;
   * null on every other row and on a deposit not answered yet. Absent from an older server.
   */
  cashAnswer?: CashAnswerDto | null;
  /**
   * USDC exchanged for cash (task Б22), on the wallet row it made: the dollars given and the rate. null on every
   * other row. Absent from an older server.
   */
  exchange?: CashExchangeDto | null;
  /**
   * Task В6: the side of this row — false «нужное», true «желаемое» — its own when `wantOverride` is set, else its
   * category's; null for a row on neither side (no purchase, or a category without a side: «Возвраты», «Без
   * категории», …). Absent from an older server.
   */
  want?: boolean | null;
  /** Task В6: the owner's choice for this one row, null when it follows its category. Absent from an older server. */
  wantOverride?: boolean | null;
}

export interface CashExchangeDto {
  /** US cents of USDC given. */
  usdc: number;
  /** Hryvnias received per dollar, to two decimals (46.74): exchangeRate. */
  rate: number;
}

export { exchangeRate } from "./exchange";

export interface CashAnswerDto {
  answer: CashDepositAnswerName;
  /** «Вывод с Binance» can be chosen: it is the answer, or a USDC income was received and the dollar rate is known. */
  canBinance: boolean;
  /**
   * What changing a «Вывод с Binance» answer does to the Binance balance: "returns" exactly what the answer took
   * off it; "untouched" for an answer given before the server kept it. null for the other answers.
   */
  binanceOnChange: "returns" | "untouched" | null;
}

export interface TransactionPageDto {
  items: TransactionDto[];
  nextCursor: string | null;
  /**
   * Per local date of this page, over the whole day and under the same filters: the signed sum of amountUah.
   * Under group "spend" only the rows that count against the limit are summed (so it is −«потрачено» of that
   * day), and a day none of whose rows counts has no entry.
   */
  dayTotals: Record<string, number>;
  /**
   * With a category, «желаемое», an account, a period, the payments outside the limit or a place chosen: the sum and the
   * count of everything found; under group "spend" of the rows that count against the limit only — except with
   * `other`, whose rows add up under every group. Otherwise null; absent from an older server.
   */
  summary?: { total: number; count: number } | null;
  /**
   * Task Д1: the kinds of the person's accounts the list can be narrowed to, in the order black, white, fop, cash
   * (the wallet once it is started). Only on the first page (without a cursor). Absent from an older server, which
   * also refuses `account`: no such filter is offered then.
   */
  accountKinds?: AccountFilterKind[];
  /**
   * Task Я8: the query filters this server takes that an older one refuses with 400 (`other`, `place`). Only on the
   * first page (without a cursor). Absent from an older server: the app then does not send them.
   */
  filters?: TransactionFilterName[];
}

export interface TransactionEditDto {
  transaction: TransactionDto;
  /** Rows changed by this edit, the edited one included. */
  updated: number;
}

export interface RecipientLabelResultDto {
  updated: number;
}

export const similarQuery = z.object({ type: txType.optional() }).strict();
export type SimilarQuery = z.infer<typeof similarQuery>;
/** Rows an edit with applyToSimilar would change, the edited one included. */
export interface SimilarCountDto {
  count: number;
}

/** A stored owner rule: an edit applied to similar rows, or an answer about a recipient. */
export interface RuleDto {
  id: number;
  matchKind: "merchant" | "iban" | "recipient";
  /** What it matches, readable: the bank text or the person's name; never an account number. */
  title: string;
  direction: "in" | "out" | null;
  type: TxTypeDto;
  category: string | null;
  label: RecipientLabelName | null;
  /** Rows that match it and have its type. */
  count: number;
}

// --- categories (В5) ----------------------------------------------------------------
/**
 * The icons a category can have: one-colour line icons from a fixed set, no emoji. The first eleven are the
 * default categories' (the app's icon names); the rest are offered for the owner's own categories.
 */
export const CATEGORY_ICONS = [
  "cart", "coffee", "car", "repeat", "ticket", "heart", "bolt", "phone", "bag", "arrowIn", "circle",
  "home", "gift", "book", "plane", "paw", "dumbbell", "user", "star", "shirt", "tool", "school", "music", "pill", "baby",
] as const;
export const categoryIcon = z.enum(CATEGORY_ICONS);
export type CategoryIcon = z.infer<typeof categoryIcon>;
/** What rows, rules and cash operations store. A default category's key is today's value (groceries, cafe, …). */
export const categoryKey = z.string().trim().min(1).max(64);
/** Unique among live categories, ignoring case. */
export const categoryName = z.string().trim().min(1).max(40);

/**
 * GET /categories: live categories in the owner's order (an older server has no such endpoint: 404). `system`:
 * «Возвраты» and «Без категории», which are not renamed or deleted. Rows of other types (taxes, transfers, …) store
 * keys that are not in this list.
 */
export interface CategoryDto {
  key: string;
  name: string;
  icon: CategoryIcon;
  system: boolean;
  /**
   * Task В6: false «нужное», true «желаемое»; null for a system category, which is on neither side. Absent from an
   * older server.
   */
  want?: boolean | null;
}
/** POST /categories: a new category, put at the end; «нужное» unless `want` says otherwise (В6). */
export const categoryInput = z.object({ name: categoryName, icon: categoryIcon, want: z.boolean().optional() }).strict();
export type CategoryInput = z.infer<typeof categoryInput>;
/** PATCH /categories/:key. A system category refuses a new name and a side (422). */
export const categoryPatch = z
  .object({ name: categoryName.optional(), icon: categoryIcon.optional(), want: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.icon !== undefined || v.want !== undefined, "name, icon or want is required");
export type CategoryPatch = z.infer<typeof categoryPatch>;
/** PUT /categories/order: every live key exactly once, in the new order (422 otherwise). */
export const categoryOrder = z.object({ keys: z.array(categoryKey).min(1).max(500) }).strict();
export type CategoryOrder = z.infer<typeof categoryOrder>;
/** DELETE /categories/:key: the operations moved to «Без категории». */
export interface CategoryDeletedDto {
  deleted: true;
  moved: number;
}

// --- cash wallet -------------------------------------------------------------------
/**
 * A cash purchase's category: any live category key (В5), own ones included; the server refuses an unknown or
 * deleted one with 400. The type keeps the default keys an older app offers.
 */
export const cashCategory = categoryKey;
export type CashCategory =
  | "groceries" | "cafe" | "transport" | "subscriptions" | "leisure" | "health" | "utilities" | "telecom" | "shopping" | "uncategorized";
/**
 * spend: a purchase, against the limit; received: cash came in; own_out: cash went to one's own other money;
 * exchange: USDC from Binance exchanged for cash (task Б22), with `usdc` the dollars given. An older server
 * does not know exchange and answers 400.
 */
export const cashOperationKind = z.enum(["spend", "received", "own_out", "exchange"]);
export type CashOperationKind = z.infer<typeof cashOperationKind>;
const cashAmount = z.number().int().positive().max(100_000_000_00);
const cashNote = z.string().trim().max(200);

export const cashStartInput = z.object({ amount: z.number().int().min(0).max(100_000_000_00), date: isoDate.optional() }).strict();
export type CashStartInput = z.infer<typeof cashStartInput>;
/** US cents of USDC given in an exchange. */
const usdcCents = z.number().int().positive().max(100_000_000_00);
export const cashOperationInput = z
  .object({
    kind: cashOperationKind,
    amount: cashAmount,
    category: cashCategory.optional(),
    usdc: usdcCents.optional(),
    date: isoDate.optional(),
    note: cashNote.optional(),
  })
  .strict()
  .refine((v) => v.kind !== "spend" || v.category !== undefined, { message: "a purchase needs a category", path: ["category"] })
  .refine((v) => (v.kind === "exchange") === (v.usdc !== undefined), { message: "an exchange, and only an exchange, needs usdc", path: ["usdc"] });
export type CashOperationInput = z.infer<typeof cashOperationInput>;
/** `usdc` only for an exchange: with kind exchange, or on a row that is one. */
export const cashOperationPatch = z
  .object({ kind: cashOperationKind, amount: cashAmount, category: cashCategory, usdc: usdcCents, date: isoDate, note: cashNote })
  .partial()
  .strict()
  .refine((v) => v.usdc === undefined || v.kind === undefined || v.kind === "exchange", { message: "usdc is only for an exchange", path: ["usdc"] });
export type CashOperationPatch = z.infer<typeof cashOperationPatch>;
export const cashCountInput = z.object({ amount: z.number().int().min(0).max(100_000_000_00) }).strict();
export type CashCountInput = z.infer<typeof cashCountInput>;
/** Operations that paid a planned payment, chosen by the owner. */
export const paymentLinksInput = z.object({ transactionIds: z.array(z.number().int().positive()).min(1).max(20) }).strict();
export type PaymentLinksInput = z.infer<typeof paymentLinksInput>;
/** What linking operations to a planned payment did. `closed` and `remaining` are absent from an older server, which always closed it. */
export interface PaymentLinksDto {
  linked: number;
  /** All operations linked to the payment now cover it (up to ₴20 short), and it is paid (task Б9). */
  closed?: boolean;
  /** Kopecks still to pay; 0 once closed. */
  remaining?: number;
}
/** "Снял наличными?" about a transfer to the owner's card at another bank; `amount` only with part. */
export const cashCardAnswer = z
  .object({ answer: z.enum(["yes", "part", "no"]), amount: z.number().int().positive().max(100_000_000_00).optional() })
  .strict();
export type CashCardAnswer = z.infer<typeof cashCardAnswer>;
/** How much of one such transfer was taken out as cash; 0 means none. */
export const cashCardPatch = z.object({ amount: z.number().int().min(0).max(100_000_000_00) }).strict();
export type CashCardPatch = z.infer<typeof cashCardPatch>;
/** «Откуда наличные?» about a cash deposit: from the wallet, a withdrawal from Binance, or something else. */
export const cashDepositAnswerName = z.enum(["wallet", "binance", "other"]);
export type CashDepositAnswerName = z.infer<typeof cashDepositAnswerName>;
/** A new answer to it from the operation's card: the earlier one is undone first. */
export const cashDepositAnswer = z.object({ answer: cashDepositAnswerName }).strict();
export type CashDepositAnswer = z.infer<typeof cashDepositAnswer>;

export interface CashWalletDto {
  started: boolean;
  /** The first day the wallet keeps records; null until started. */
  start: string | null;
  /** Kopecks in the pocket, as recorded. */
  balance: number;
}

/**
 * One discrepancy the nightly ledger check found (task Б11). `amount` is in minor units of `currency`, signed:
 * bank_balance — the bank's balance minus ours on that account; own_transfers — 0, see `count`; categories —
 * spending in no category; day_spent — one screen minus the ledger on the day `since`; cash_wallet — the wallet now.
 * `since` is the first Kyiv day it applies ('YYYY-MM-DD'). A newer server may send a kind this app does not know.
 */
export interface LedgerCheckIssueDto {
  kind: "bank_balance" | "own_transfers" | "categories" | "day_spent" | "cash_wallet" | (string & {});
  amount: number;
  currency: string;
  since: string | null;
  /** bank_balance: the account's kind (black, white, fop, jar, other) and, for a jar, its title. */
  accountKind?: string;
  accountTitle?: string | null;
  /** own_transfers: how many legs have no other leg here. */
  count?: number;
}

/** The latest ledger check: when it ran and what did not add up; no issues means all is well. */
export interface LedgerCheckDto {
  ranAt: string;
  issues: LedgerCheckIssueDto[];
}

// --- insights («Итоги», task В1) ---------------------------------------------
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Without `month`, the current Kyiv month. */
export const insightsMonthQuery = z.object({ month: yearMonth.optional() }).strict();

/**
 * A month's spending by category against the same days of the month before. Spending is the limit's (what
 * «Сегодня» calls spent): kopecks, refunds negative, so `spent` is the sum of the categories. Categories are the
 * stored keys (groceries, cafe, refund, uncategorized, …), the month's largest sum first; a category spent on only
 * in the earlier stretch comes with `spent` 0 and `count` 0.
 */
export const insightsMonthDto = z
  .object({
    month: yearMonth,
    /** The last day counted: today for the current month, the last day for a past one. */
    through: isoDate,
    /** The stretch of the month before: from its 1st to the same day number, or to its last day when shorter. */
    previous: z.object({ from: isoDate, to: isoDate }).strict(),
    spent: money,
    previousSpent: money,
    categories: z.array(
      z.object({ category: z.string().min(1), spent: money, previousSpent: money, count: z.number().int().nonnegative() }).strict(),
    ),
    /**
     * Task В3, optional (an older server does not send it): the month's largest places, at most five, by the sum
     * over the same stretch as `spent`. A place is the bank's counterparty of purchases from the limit; person
     * transfers and cash wallet entries are not places. `key` is the counterparty's opaque id (as `counterKey` of a
     * transaction), `name` is how «Операции» names it, `spent` is kopecks after refunds there (positive), `visits`
     * the purchases, `isNew` — no purchase there in the three months before.
     */
    places: z
      .array(
        z
          .object({
            key: z.string().regex(/^[0-9a-f]{16}$/),
            name: z.string().min(1),
            spent: money.refine((n) => n > 0, "a place has a positive sum"),
            visits: z.number().int().positive(),
            isNew: z.boolean(),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    /**
     * Task В2а, optional (an older server does not send it): kopecks the payments outside the limit took over the
     * same stretch as `spent` — planned payments, taxes, debt payments (installments among them); not own transfers,
     * withdrawals, loans given, savings or a count's shortfall. Never below zero, and not part of `spent`.
     */
    otherPayments: money.refine((n) => n >= 0, "not below zero").optional(),
    /** The same over the stretch of the month before (`previous`). */
    previousOtherPayments: money.refine((n) => n >= 0, "not below zero").optional(),
    /**
     * Task В4, optional (an older server does not send it): subscriptions as of `through`, found in the card
     * purchases from the limit over the six months up to it — one place charging about the same sum about monthly,
     * three charges at least. `key` is the place's counterparty key (two subscriptions at one place share it), `name`
     * as «Операции» names it, `amount` the latest charge (positive kopecks), `raisedBy` how much it is above the one
     * before (0 when not raised), `missed` the charges due that did not come (0: still charged). `monthly` is the sum
     * of `amount` over the ones with `missed` 0. Items: the ones still charged, largest first, then the rest.
     */
    subscriptions: z
      .object({
        monthly: money.refine((n) => n >= 0, "not below zero"),
        items: z.array(
          z
            .object({
              key: z.string().regex(/^[0-9a-f]{16}$/),
              name: z.string().min(1),
              amount: money.refine((n) => n > 0, "a charge is positive"),
              lastDate: isoDate,
              raisedBy: money.refine((n) => n >= 0, "not below zero"),
              missed: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    /**
     * Task В6, optional (an older server does not send it): the part of `spent` that went on «желаемое» — purchases
     * whose own side, else their category's, is «желаемое»; refunds there lower it, «Возвраты» and «Без категории»
     * are on neither side. Never below zero, and never added to `spent`. «Операции» with want=true list its rows.
     */
    wanted: money.refine((n) => n >= 0, "not below zero").optional(),
    /** The same over the stretch of the month before (`previous`). */
    previousWanted: money.refine((n) => n >= 0, "not below zero").optional(),
  })
  .strict();
export type InsightsMonthDto = z.infer<typeof insightsMonthDto>;

// --- observations (task В7) --------------------------------------------------
/**
 * One observation for the phrase of the day; the app builds the text. `spike`: a category spent more than usual —
 * `period` "month" (from the 1st to today) or "week" (the 7 days to today), `spent` over that span and `usual` the
 * median of the same days of the three months before (whole hryvnias), both kopecks; `amount` null. `subscriptions`
 * (the shortage mode only): `amount` what the subscriptions are expected to charge from `from` to `to`, before the
 * income; `period`, `category`, `spent`, `usual` null. `from`/`to` are the days «Операции» open with (for a spike,
 * filtered by `category`).
 */
export const observationDto = z
  .object({
    kind: z.enum(["spike", "subscriptions"]),
    period: z.enum(["month", "week"]).nullable(),
    category: z.string().min(1).nullable(),
    spent: money.nullable(),
    usual: money.nullable(),
    amount: money.nullable(),
    from: isoDate,
    to: isoDate,
  })
  .strict();
export type ObservationDto = z.infer<typeof observationDto>;

/** `GET /observations/today` and the answer to `POST /observations/shown`: today's observation, or none. */
export const observationTodayDto = z.object({ observation: observationDto.nullable() }).strict();
export type ObservationTodayDto = z.infer<typeof observationTodayDto>;

/**
 * Which observation: a spike of one category, or the subscriptions kind (no category). The app sends it to
 * `POST /observations/shown` when it displays the observation, and to `POST /observations/dismiss` for
 * «Не показывать такое».
 */
export const observationRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spike"), category: categoryKey }).strict(),
  z.object({ kind: z.literal("subscriptions"), category: z.null() }).strict(),
]);
export type ObservationRef = z.infer<typeof observationRef>;
