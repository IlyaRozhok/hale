export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** monobank allows one private-endpoint request per 60 s. */
export const MONO_MIN_INTERVAL_MS = 60_000;

/**
 * Serialises callers and keeps at least `intervalMs` between the moments
 * they are released. Time is injectable so tests never really wait.
 */
export class RateGate {
  private tail: Promise<void> = Promise.resolve();
  private lastRelease: number | undefined;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly intervalMs: number = MONO_MIN_INTERVAL_MS,
  ) {}

  acquire(): Promise<void> {
    const turn = this.tail.then(async () => {
      if (this.lastRelease !== undefined) {
        const wait = this.lastRelease + this.intervalMs - this.clock.now();
        if (wait > 0) await this.clock.sleep(wait);
      }
      this.lastRelease = this.clock.now();
    });
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}
