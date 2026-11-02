/** The current instant; tests set `fixed` to travel in time. */
export class Clock {
  fixed: Date | null = null;

  now(): Date {
    return this.fixed ?? new Date();
  }
}
