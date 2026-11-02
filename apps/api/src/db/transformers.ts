import type { ValueTransformer } from "typeorm";

/**
 * bigint columns come back from pg as strings. Money is stored in minor
 * units and must fit in a JS safe integer; anything else is a hard error
 * rather than silent precision loss.
 */
export const bigintTransformer: ValueTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    if (value === null || value === undefined) return value;
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`bigint value is not a safe integer: ${String(value)}`);
    }
    return value;
  },
  from(value: string | null | undefined): number | null | undefined {
    if (value === null || value === undefined) return value;
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new RangeError(`bigint value is not a safe integer: ${value}`);
    }
    return n;
  },
};

/** numeric columns (exchange rates) as plain numbers. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null | undefined) =>
    value === null || value === undefined ? value : Number(value),
};
