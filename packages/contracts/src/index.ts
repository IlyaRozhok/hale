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

export const incomeDateInput = z.object({ date: isoDate }).strict();
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
};
export const scheduledPaymentInput = z
  .object({ ...paymentShape, match_hint: paymentShape.match_hint.optional(), overpayment: paymentShape.overpayment.optional() })
  .strict();
export const scheduledPaymentPatch = partial(z.object(paymentShape));
export type ScheduledPaymentInput = z.infer<typeof scheduledPaymentInput>;

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

// --- private/seed.json ------------------------------------------------------
const seedPayment = z.object({ ...paymentShape, match_hint: paymentShape.match_hint.optional(), overpayment: paymentShape.overpayment.optional(), paid: z.boolean().optional() }).strict();
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
}

export interface TodayDto {
  date: string;
  state: DailyStateDto;
  /** UAH per USD; 0 when no rate is known. */
  usdRate: number;
  rateStale: boolean;
  accounts: { own: number; credit: number; fop: number; binance: number };
  upcoming: { id: string; name: string; amount: number; dueOn: string; kind: string }[];
  questions: { id: string; kind: "usdc_arrived" | "income_date" | "recipient_label"; text: string }[];
  badCases: { id: string; text: string }[];
  runOutOn: string | null;
  /** Last successful sync, null if there was none yet. */
  syncedAt: string | null;
  syncStale: boolean;
  limitVisual: "mercury" | "ring";
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
]);
export type TxTypeDto = z.infer<typeof txType>;

export const transactionsQuery = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    type: txType.optional(),
    needsLabel: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  })
  .strict();
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

export const recipientLabelName = z.enum(["obligation", "debt_repayment", "shared_budget", "help", "one_off"]);
export type RecipientLabelName = z.infer<typeof recipientLabelName>;
export const recipientLabelInput = z
  .object({ counterKey: z.string().regex(/^[0-9a-f]{16}$/), label: recipientLabelName })
  .strict();
export type RecipientLabelInput = z.infer<typeof recipientLabelInput>;

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
}

export interface TransactionPageDto {
  items: TransactionDto[];
  nextCursor: string | null;
}

export interface TransactionEditDto {
  transaction: TransactionDto;
  /** Rows changed by this edit, the edited one included. */
  updated: number;
}

export interface RecipientLabelResultDto {
  updated: number;
}
