import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";
import { bigintTransformer as bt, numericTransformer as nt } from "../transformers";

const id = () => PrimaryGeneratedColumn("identity", { generatedIdentity: "BY DEFAULT" });
const money = (extra: { nullable?: boolean; name?: string } = {}) =>
  Column({ type: "bigint", transformer: bt, ...extra });

@Entity("accounts")
export class Account {
  @id() id!: number;
  @Column({ type: "text", unique: true }) external_id!: string;
  @Column({ type: "text" }) kind!: "black" | "white" | "fop" | "jar" | "other" | "cash";
  @Column({ type: "text" }) currency!: string;
  @money() balance!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) credit_limit!: number;
  @Column({ type: "timestamptz", nullable: true }) balance_at!: Date | null;
  @Column({ type: "text", nullable: true }) iban!: string | null;
  @Column({ type: "text", nullable: true }) title!: string | null;
  /** Д2а: the person's mark that the account is own money; null follows the kind (domain/ledger.ts countsAsOwn). */
  @Column({ type: "boolean", nullable: true }) counts_as_own!: boolean | null;
  /** Д2а: the person's own name for the account; null shows the default one. */
  @Column({ type: "text", nullable: true }) name!: string | null;
}

@Entity("transactions")
export class Transaction {
  @id() id!: number;
  @Column({ type: "text", unique: true }) external_id!: string;
  @Column({ type: "integer" }) account_id!: number;
  @Column({ type: "timestamptz" }) occurred_at!: Date;
  @Column({ type: "date" }) local_date!: string;
  @Column({ type: "text", default: "" }) description!: string;
  @Column({ type: "text", nullable: true }) comment!: string | null;
  @Column({ type: "integer", nullable: true }) mcc!: number | null;
  @money() amount!: number;
  @Column({ type: "bigint", transformer: bt, nullable: true }) amount_uah!: number | null;
  @Column({ type: "numeric", precision: 20, scale: 8, nullable: true, transformer: nt })
  fx_rate!: number | null;
  @Column({ type: "boolean", default: false }) hold!: boolean;
  @Column({ type: "text", nullable: true }) counter_iban!: string | null;
  @Column({ type: "text", nullable: true }) counter_name!: string | null;
  @Column({ type: "text", nullable: true }) type!: string | null;
  @Column({ type: "text", nullable: true }) category!: string | null;
  @Column({ type: "text", nullable: true }) type_source!: "rule" | "owner" | "auto" | null;
  /** For an owner-typed row: the rule it was changed through; NULL by the owner's hand alone; -1 typed before Б36. */
  @Column({ type: "integer", nullable: true }) owner_rule_id!: number | null;
  @Column({ type: "boolean", default: false }) needs_label!: boolean;
  @Column({ type: "boolean", default: false }) usdc_checked!: boolean;
  @Column({ type: "boolean", default: false }) from_wallet!: boolean;
  @Column({ type: "bigint", nullable: true, transformer: bt }) cash_amount!: number | null;
  /** The account balance right after the operation, as the bank sent it. NULL on rows stored before A16. */
  @Column({ type: "bigint", nullable: true, transformer: bt }) balance_after!: number | null;
  /** The account's credit limit when the operation arrived by webhook; NULL otherwise (never guessed later). */
  @Column({ type: "bigint", nullable: true, transformer: bt }) credit_limit_at!: number | null;
  /** В6: the owner's «нужное» (false) / «желаемое» (true) for this one purchase; NULL follows its category. */
  @Column({ type: "boolean", nullable: true }) want_override!: boolean | null;
  @Column({ type: "jsonb" }) raw!: unknown;
}

@Entity("rules")
export class Rule {
  @id() id!: number;
  @Column({ type: "text" }) match_kind!: "merchant" | "iban" | "recipient";
  @Column({ type: "text" }) match_value!: string;
  @Column({ type: "text" }) type!: string;
  @Column({ type: "text", nullable: true }) category!: string | null;
  @Column({ type: "text", nullable: true }) label!: string | null;
  @Column({ type: "text", nullable: true }) direction!: "in" | "out" | null;
}

@Entity("expected_incomes")
export class ExpectedIncome {
  @id() id!: number;
  /** Kept for an older app: follows the flags (domain/incomes sourceOf). */
  @Column({ type: "text", nullable: true }) source!: "fop" | "usdc" | null;
  @Column({ type: "text" }) name!: string;
  @money() amount!: number;
  @Column({ type: "text" }) currency!: string;
  @Column({ type: "smallint" }) window_start_day!: number;
  @Column({ type: "smallint" }) window_end_day!: number;
  @Column({ type: "text" }) schedule!: "monthly" | "twice" | "none";
  @Column({ type: "smallint", nullable: true }) second_day!: number | null;
  @Column({ type: "boolean" }) pays_fop_tax!: boolean;
  @Column({ type: "boolean" }) crypto!: boolean;
  @Column({ type: "integer", nullable: true }) account_id!: number | null;
  @Column({ type: "integer", nullable: true }) manual_balance_id!: number | null;
  @Column({ type: "boolean" }) to_cash!: boolean;
}

@Entity("income_events")
export class IncomeEvent {
  @id() id!: number;
  @Column({ type: "integer" }) expected_income_id!: number;
  @Column({ type: "text" }) period!: string;
  /** 2 for the second payment of a twice-monthly income in the month. */
  @Column({ type: "smallint", default: 1 }) slot!: number;
  @Column({ type: "date" }) expected_on!: string;
  @Column({ type: "timestamptz", nullable: true }) received_at!: Date | null;
  @Column({ type: "bigint", transformer: bt, nullable: true }) amount_uah!: number | null;
  @Column({ type: "text", default: "expected" }) status!: string;
  @Column({ type: "integer", nullable: true }) matched_transaction_id!: number | null;
}

@Entity("scheduled_payments")
export class ScheduledPayment {
  @id() id!: number;
  @Column({ type: "text" }) kind!: "obligation" | "installment" | "tax";
  @Column({ type: "text" }) name!: string;
  @money() amount!: number;
  @Column({ type: "text" }) currency!: string;
  @Column({ type: "date" }) due_on!: string;
  @Column({ type: "timestamptz", nullable: true }) paid_at!: Date | null;
  @Column({ type: "integer", nullable: true }) transaction_id!: number | null;
  @Column({ type: "text", nullable: true }) match_hint!: string | null;
  @Column({ type: "boolean", default: false }) overpayment!: boolean;
  @Column({ type: "integer", nullable: true }) recurring_id!: number | null;
  @Column({ type: "text", nullable: true }) tax_quarter!: string | null;
  @Column({ type: "boolean", default: false }) is_estimate!: boolean;
}

@Entity("recurring_payments")
export class RecurringPayment {
  @id() id!: number;
  @Column({ type: "text", default: "obligation" }) kind!: "obligation" | "installment" | "tax";
  @Column({ type: "text" }) name!: string;
  @money() amount!: number;
  @Column({ type: "text" }) currency!: string;
  @Column({ type: "smallint" }) day_of_month!: number;
  @Column({ type: "text", nullable: true }) match_hint!: string | null;
  @Column({ type: "boolean", default: true }) active!: boolean;
  /** Kyiv day the series was set up: no payment of it falls due before this day (Б29). */
  @Column({ type: "date" }) starts_on!: string;
}

@Entity("manual_balances")
export class ManualBalance {
  @id() id!: number;
  @Column({ type: "text" }) name!: string;
  @money() amount!: number;
  @Column({ type: "text" }) currency!: string;
  @Column({ type: "boolean", default: true }) counts_as_own!: boolean;
}

@Entity("loans")
export class Loan {
  @id() id!: number;
  @money() amount!: number;
  @Column({ type: "date" }) received_on!: string;
  @Column({ type: "integer", nullable: true }) source_transaction_id!: number | null;
  @Column({ type: "timestamptz", nullable: true }) repaid_at!: Date | null;
  @Column({ type: "text", default: "other" }) kind!: "short" | "other";
  @Column({ type: "bigint", transformer: bt, default: 0 }) repaid_amount!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) service_cost!: number;
  @Column({ type: "boolean", default: false }) repaid_date_unknown!: boolean;
  @Column({ type: "text", nullable: true }) note!: string | null;
  /** «Вернуть до» (Б7): with it the loan behaves as a payment on that day. */
  @Column({ type: "date", nullable: true }) due_on!: string | null;
}

@Entity("settings")
export class Settings {
  @PrimaryColumn({ type: "smallint", default: 1 }) id!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) lifestyle_cap!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) food_floor!: number;
  @Column({ type: "integer", default: 600 }) tax_rate_bp!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) esv_quarter!: number;
  @Column({ type: "text", default: "mercury" }) limit_visual!: "mercury" | "ring";
  @Column({ type: "timestamptz", nullable: true }) last_sync_at!: Date | null;
  @Column({ type: "timestamptz", nullable: true }) last_contact_at!: Date | null;
  @Column({ type: "date", default: () => "CURRENT_DATE" }) tracking_start!: string;
  @Column({ type: "date", nullable: true }) cash_start!: string | null;
  /** The moment the wallet started (Б39): withdrawals before it on its first day are inside the opening balance. */
  @Column({ type: "timestamptz", nullable: true }) cash_started_at!: Date | null;
  /** The moment of the last count of the pocket (Б40): the next count row keeps it, to know which count came first after a deposit. */
  @Column({ type: "timestamptz", nullable: true }) cash_counted_at!: Date | null;
  /** The CLASSIFIER_VERSION the rows were last reclassified with (Б49): an older one queues a reclassify at start. */
  @Column({ type: "integer", default: 0 }) classifier_version!: number;
}

@Entity("bridge_plans")
export class BridgePlan {
  @id() id!: number;
  @money() daily_amount!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) credit_plan!: number;
  @Column({ type: "date" }) created_on!: string;
  @Column({ type: "date", nullable: true }) closed_on!: string | null;
  @Column({ type: "text", default: "" }) basis!: string;
}

@Entity("daily_snapshots")
export class DailySnapshot {
  @PrimaryColumn({ type: "date" }) local_date!: string;
  @money() daily_limit!: number;
  @Column({ type: "text" }) mode!: string;
}

@Entity("fx_rates")
export class FxRate {
  @PrimaryColumn({ type: "text" }) currency!: string;
  @PrimaryColumn({ type: "timestamptz" }) fetched_at!: Date;
  @Column({ type: "numeric", precision: 20, scale: 8, transformer: nt }) rate!: number;
}

@Entity("jobs")
export class Job {
  @id() id!: number;
  @Column({ type: "text" }) kind!: string;
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" }) payload!: unknown;
  @Column({ type: "timestamptz", default: () => "now()" }) run_after!: Date;
  @Column({ type: "text", default: "pending" }) status!: string;
  @Column({ type: "integer", default: 0 }) attempts!: number;
  @Column({ type: "text", nullable: true }) last_error!: string | null;
}

@Entity("devices")
export class Device {
  @id() id!: number;
  @Column({ type: "text" }) name!: string;
  @Column({ type: "text", nullable: true }) push_token!: string | null;
  @Column({ type: "text", unique: true }) token_hash!: string;
}

@Entity("notifications_log")
export class NotificationLog {
  @id() id!: number;
  @Column({ type: "text", unique: true }) key!: string;
  @Column({ type: "timestamptz", default: () => "now()" }) sent_at!: Date;
  @Column({ type: "text" }) kind!: string;
}

@Entity("goals")
export class Goal {
  @id() id!: number;
  @Column({ type: "text" }) name!: string;
  @Column({ type: "bigint", transformer: bt }) target_cents!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) saved_cents!: number;
  @Column({ type: "integer", default: 0 }) sort!: number;
  @Column({ type: "timestamptz", default: () => "now()" }) created_at!: Date;
  /** ЯМ5: the target's currency (the place's own); minor units. */
  @Column({ type: "text", default: "USD" }) currency!: string;
  /** ЯМ5: the place the goal is kept in, one of the two or none. */
  @Column({ type: "integer", nullable: true }) account_id!: number | null;
  @Column({ type: "integer", nullable: true }) manual_balance_id!: number | null;
}

/** A spending category (В5). `key` is what rows store; a deleted one keeps its row so its key is not reused. */
@Entity("categories")
export class Category {
  @id() id!: number;
  @Column({ type: "text", unique: true }) key!: string;
  @Column({ type: "text" }) name!: string;
  @Column({ type: "text" }) icon!: string;
  @Column({ type: "integer" }) position!: number;
  @Column({ type: "boolean", default: false }) system!: boolean;
  /** В6: false «нужное», true «желаемое»; NULL exactly for a system category, which is on neither side. */
  @Column({ type: "boolean", nullable: true }) want!: boolean | null;
  @Column({ type: "timestamptz", nullable: true }) deleted_at!: Date | null;
}

export const entities = [
  Account, Transaction, Rule, ExpectedIncome, IncomeEvent, ScheduledPayment, RecurringPayment,
  ManualBalance, Loan, Settings, BridgePlan, DailySnapshot, FxRate, Job,
  Device, NotificationLog, Goal, Category,
];
