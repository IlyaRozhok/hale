// The one place that names the product's time zone and owns business "now". Every "day" in Hale is a
// Kyiv calendar day; code that needs the zone imports it from here (a guard test keeps it that way).
// No Nest, no I/O: `domain/` may import from this file too.

/** The product's time zone (IANA name). A constant, so it is safe to interpolate into SQL. */
export const KYIV_TZ = "Europe/Kyiv";

/** SQL: the Kyiv calendar day (`date`) of a `timestamptz` expression. */
export function kyivDaySql(instant: string): string {
  return `(${instant} AT TIME ZONE '${KYIV_TZ}')::date`;
}

/** SQL: the instant (`timestamptz`) at which Kyiv wall-clock time shows the `timestamp` expression. */
export function kyivInstantSql(local: string): string {
  return `${local} AT TIME ZONE '${KYIV_TZ}'`;
}

/** The current instant; tests set `fixed` to travel in time. */
export class Clock {
  fixed: Date | null = null;

  now(): Date {
    return this.fixed ?? new Date();
  }
}
