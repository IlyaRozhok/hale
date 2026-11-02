import "reflect-metadata";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { Init1793577600000 } from "./migrations/0001-init";
import { NullableAmountUah1793664000000 } from "./migrations/0002-nullable-amount-uah";
import { SettingsLastSync1793750400000 } from "./migrations/0003-settings-last-sync";

export const migrations = [
  Init1793577600000,
  NullableAmountUah1793664000000,
  SettingsLastSync1793750400000,
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
