import "reflect-metadata";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { Init1793577600000 } from "./migrations/0001-init";
import { NullableAmountUah1793664000000 } from "./migrations/0002-nullable-amount-uah";
import { SettingsLastSync1793750400000 } from "./migrations/0003-settings-last-sync";
import { OwnIdentityNeedsLabel1793836800000 } from "./migrations/0004-own-identity-needs-label";
import { PlanLinks1793923200000 } from "./migrations/0005-plan-links";
import { RecurringPayments1794009600000 } from "./migrations/0006-recurring-payments";
import { BridgePlanBasis1794096000000 } from "./migrations/0007-bridge-plan-basis";
import { RuleDirection1794182400000 } from "./migrations/0008-rule-direction";
import { LoanTracking1794268800000 } from "./migrations/0009-loan-tracking";
import { SettingsLastContact1794355200000 } from "./migrations/0010-settings-last-contact";
import { TaxQuarter1794441600000 } from "./migrations/0011-tax-quarter";
import { TransactionsUsdcChecked1794528000000 } from "./migrations/0012-transactions-usdc-checked";
import { Goals1794614400000 } from "./migrations/0013-goals";
import { LoanServiceCost1794700800000 } from "./migrations/0014-loan-service-cost";
import { LoanRepaidDateUnknown1794787200000 } from "./migrations/0015-loan-repaid-date-unknown";
import { CashWallet1794873600000 } from "./migrations/0016-cash-wallet";
import { CashAndRulesFlow1794960000000 } from "./migrations/0017-cash-and-rules-flow";
import { TransactionsCreditLimitAt1795046400000 } from "./migrations/0018-transactions-credit-limit-at";
import { DayTermCashLoans1795132800000 } from "./migrations/0019-day-term-cash-loans";
import { PaymentDismissals1795219200000 } from "./migrations/0020-payment-dismissals";
import { CashAnswers1795305600000 } from "./migrations/0021-cash-answers";
import { PaymentClosedByLinks1795392000000 } from "./migrations/0022-payment-closed-by-links";
import { LedgerChecks1795478400000 } from "./migrations/0023-ledger-checks";
import { LoanDueOn1795564800000 } from "./migrations/0024-loan-due-on";
import { CashExchanges1795651200000 } from "./migrations/0025-cash-exchanges";
import { IncomeEventDateByHand1795737600000 } from "./migrations/0026-income-event-date-by-hand";
import { RecurringStart1795824000000 } from "./migrations/0027-recurring-start";
import { CashStartedAt1795910400000 } from "./migrations/0028-cash-started-at";
import { CashCountAbsorbed1795996800000 } from "./migrations/0029-cash-count-absorbed";

export const migrations = [
  Init1793577600000,
  NullableAmountUah1793664000000,
  SettingsLastSync1793750400000,
  OwnIdentityNeedsLabel1793836800000,
  PlanLinks1793923200000,
  RecurringPayments1794009600000,
  BridgePlanBasis1794096000000,
  RuleDirection1794182400000,
  LoanTracking1794268800000,
  SettingsLastContact1794355200000,
  TaxQuarter1794441600000,
  TransactionsUsdcChecked1794528000000,
  Goals1794614400000,
  LoanServiceCost1794700800000,
  LoanRepaidDateUnknown1794787200000,
  CashWallet1794873600000,
  CashAndRulesFlow1794960000000,
  TransactionsCreditLimitAt1795046400000,
  DayTermCashLoans1795132800000,
  PaymentDismissals1795219200000,
  CashAnswers1795305600000,
  PaymentClosedByLinks1795392000000,
  LedgerChecks1795478400000,
  LoanDueOn1795564800000,
  CashExchanges1795651200000,
  IncomeEventDateByHand1795737600000,
  RecurringStart1795824000000,
  CashStartedAt1795910400000,
  CashCountAbsorbed1795996800000,
];

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    entities,
    migrations,
    synchronize: false,
  });
}
