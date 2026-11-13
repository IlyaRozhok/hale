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
export const incomeSource = z.enum(["fop", "usdc"]);
export const expectedIncomeInput = z
  .object({
    source: incomeSource,
    amount: money.positive(),
    currency,
    window_start_day: day,
    window_end_day: day,
  })
  .strict()
  .refine((v) => v.window_start_day <= v.window_end_day, "window start is after its end");
export const expectedIncomePatch = partial(
  z.object({
    source: incomeSource,
    amount: money.positive(),
    currency,
    window_start_day: day,
    window_end_day: day,
  }),
);
export type ExpectedIncomeInput = z.infer<typeof expectedIncomeInput>;
export type ExpectedIncomePatch = z.infer<typeof expectedIncomePatch>;

export interface ExpectedIncomeDto {
  id: number;
  source: "fop" | "usdc";
  amount: number;
  currency: string;
  window_start_day: number;
  window_end_day: number;
}

export interface IncomeEventDto {
  id: number;
  expected_income_id: number;
  period: string;
  expected_on: string;
  status: string;
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
};
export const loanInput = z
  .object({ amount: loanShape.amount, received_on: loanShape.received_on, note: loanShape.note.optional() })
  .strict();
export const loanPatch = partial(z.object(loanShape));
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
  /** Entered by hand, so it can be deleted. */
  manual: boolean;
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
const balanceShape = {
  name: z.string().min(1).max(100),
  amount: money,
  currency,
  counts_as_own: z.boolean(),
};
export const manualBalanceInput = z
  .object({ ...balanceShape, counts_as_own: balanceShape.counts_as_own.optional() })
  .strict();
export const manualBalancePatch = partial(z.object(balanceShape));
export type ManualBalanceInput = z.infer<typeof manualBalanceInput>;

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

export interface TodayDto {
  date: string;
  state: DailyStateDto;
  /** UAH per USD; 0 when no rate is known. */
  usdRate: number;
  rateStale: boolean;
  /** `cash` is the wallet, already inside `own`; 0 until the wallet is started. */
  accounts: { own: number; credit: number; fop: number; binance: number; cash: number };
  /** `amount` in kopecks, already converted to hryvnias; `currency` is the payment's own. */
  upcoming: { id: string; name: string; amount: number; dueOn: string; kind: string; currency: string }[];
  questions: {
    id: string;
    kind: "usdc_arrived" | "usdc_match" | "income_date" | "recipient_label" | "cash_source" | "cash_card";
    text: string;
    /** Who a recipient question is about. */
    subject?: string;
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
  runOutOn: string | null;
  /** Last successful contact with the bank (webhook item, reconcile or balance refresh), null if there was none yet. */
  syncedAt: string | null;
  syncStale: boolean;
  limitVisual: "mercury" | "ring";
  /** Savings goals in US cents, in display order. */
  goals: { id: number; name: string; saved: number; target: number }[];
  /** Days within the limit in a row, back from yesterday. */
  streak: number;
  /** The money day by day until the next income. Absent from a server older than the app. */
  runway?: RunwayDto;
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
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "from must not be after to");
export type TransactionsQuery = z.infer<typeof transactionsQuery>;

export const transactionPatch = z
  .object({
    type: txType.optional(),
    category: z.string().trim().min(1).max(64).optional(),
    applyToSimilar: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.type !== undefined || v.category !== undefined, "type or category is required");
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
   * With a category or a period chosen: the sum and the count of everything found; under group "spend" of
   * the rows that count against the limit only. Otherwise null; absent from an older server.
   */
  summary?: { total: number; count: number } | null;
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

// --- cash wallet -------------------------------------------------------------------
/** Categories a cash purchase can have. */
export const cashCategory = z.enum([
  "groceries", "cafe", "transport", "subscriptions", "leisure", "health", "utilities", "telecom", "shopping", "uncategorized",
]);
export type CashCategory = z.infer<typeof cashCategory>;
/** spend: a purchase, against the limit; received: cash came in; own_out: cash went to one's own other money. */
export const cashOperationKind = z.enum(["spend", "received", "own_out"]);
export type CashOperationKind = z.infer<typeof cashOperationKind>;
const cashAmount = z.number().int().positive().max(100_000_000_00);
const cashNote = z.string().trim().max(200);

export const cashStartInput = z.object({ amount: z.number().int().min(0).max(100_000_000_00), date: isoDate.optional() }).strict();
export type CashStartInput = z.infer<typeof cashStartInput>;
export const cashOperationInput = z
  .object({ kind: cashOperationKind, amount: cashAmount, category: cashCategory.optional(), date: isoDate.optional(), note: cashNote.optional() })
  .strict()
  .refine((v) => v.kind !== "spend" || v.category !== undefined, { message: "a purchase needs a category", path: ["category"] });
export type CashOperationInput = z.infer<typeof cashOperationInput>;
export const cashOperationPatch = z
  .object({ kind: cashOperationKind, amount: cashAmount, category: cashCategory, date: isoDate, note: cashNote })
  .partial()
  .strict();
export type CashOperationPatch = z.infer<typeof cashOperationPatch>;
export const cashCountInput = z.object({ amount: z.number().int().min(0).max(100_000_000_00) }).strict();
export type CashCountInput = z.infer<typeof cashCountInput>;
/** Operations that paid a planned payment, chosen by the owner. */
export const paymentLinksInput = z.object({ transactionIds: z.array(z.number().int().positive()).min(1).max(20) }).strict();
export type PaymentLinksInput = z.infer<typeof paymentLinksInput>;
/** "Снял наличными?" about a transfer to the owner's card at another bank; `amount` only with part. */
export const cashCardAnswer = z
  .object({ answer: z.enum(["yes", "part", "no"]), amount: z.number().int().positive().max(100_000_000_00).optional() })
  .strict();
export type CashCardAnswer = z.infer<typeof cashCardAnswer>;
/** How much of one such transfer was taken out as cash; 0 means none. */
export const cashCardPatch = z.object({ amount: z.number().int().min(0).max(100_000_000_00) }).strict();
export type CashCardPatch = z.infer<typeof cashCardPatch>;

export interface CashWalletDto {
  started: boolean;
  /** The first day the wallet keeps records; null until started. */
  start: string | null;
  /** Kopecks in the pocket, as recorded. */
  balance: number;
}
