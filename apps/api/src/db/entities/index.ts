import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";
import { bigintTransformer as bt, numericTransformer as nt } from "../transformers";

const id = () => PrimaryGeneratedColumn("identity", { generatedIdentity: "BY DEFAULT" });
const money = (extra: { nullable?: boolean; name?: string } = {}) =>
  Column({ type: "bigint", transformer: bt, ...extra });

@Entity("accounts")
export class Account {
  @id() id!: number;
  @Column({ type: "text", unique: true }) external_id!: string;
  @Column({ type: "text" }) kind!: "black" | "white" | "fop" | "jar" | "other";
  @Column({ type: "text" }) currency!: string;
  @money() balance!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) credit_limit!: number;
  @Column({ type: "timestamptz", nullable: true }) balance_at!: Date | null;
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
}

@Entity("expected_incomes")
export class ExpectedIncome {
  @id() id!: number;
  @Column({ type: "text" }) source!: "fop" | "usdc";
  @money() amount!: number;
  @Column({ type: "text" }) currency!: string;
  @Column({ type: "smallint" }) window_start_day!: number;
  @Column({ type: "smallint" }) window_end_day!: number;
}

@Entity("income_events")
export class IncomeEvent {
  @id() id!: number;
  @Column({ type: "integer" }) expected_income_id!: number;
  @Column({ type: "text" }) period!: string;
  @Column({ type: "date" }) expected_on!: string;
  @Column({ type: "timestamptz", nullable: true }) received_at!: Date | null;
  @Column({ type: "bigint", transformer: bt, nullable: true }) amount_uah!: number | null;
  @Column({ type: "text", default: "expected" }) status!: string;
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
  @Column({ type: "text", nullable: true }) note!: string | null;
}

@Entity("settings")
export class Settings {
  @PrimaryColumn({ type: "smallint", default: 1 }) id!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) lifestyle_cap!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) food_floor!: number;
  @Column({ type: "integer", default: 600 }) tax_rate_bp!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) esv_quarter!: number;
  @Column({ type: "text", default: "mercury" }) limit_visual!: "mercury" | "ring";
}

@Entity("bridge_plans")
export class BridgePlan {
  @id() id!: number;
  @money() daily_amount!: number;
  @Column({ type: "bigint", transformer: bt, default: 0 }) credit_plan!: number;
  @Column({ type: "date" }) created_on!: string;
  @Column({ type: "date", nullable: true }) closed_on!: string | null;
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

export const entities = [
  Account, Transaction, Rule, ExpectedIncome, IncomeEvent, ScheduledPayment,
  ManualBalance, Loan, Settings, BridgePlan, DailySnapshot, FxRate, Job,
  Device, NotificationLog,
];
