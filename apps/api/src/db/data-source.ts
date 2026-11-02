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
