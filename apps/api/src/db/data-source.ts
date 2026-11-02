import "reflect-metadata";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { Init1793577600000 } from "./migrations/0001-init";

export const migrations = [Init1793577600000];

export function createDataSource(url: string): DataSource {
  return new DataSource({
    type: "postgres",
    url,
    entities,
    migrations,
    synchronize: false,
  });
}
