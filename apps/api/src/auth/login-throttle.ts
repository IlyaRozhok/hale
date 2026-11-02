const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

/**
 * In-memory brute-force guard for the single owner login. One counter for the
 * whole instance (there is one owner and one server); state resets on
 * restart, on a successful login, or 15 minutes after the last failure.
 */
export class LoginThrottle {
  private failures = 0;
  private lastFailureAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  isLocked(): boolean {
    if (this.failures === 0) return false;
    if (this.now() - this.lastFailureAt >= LOCK_MS) {
      this.reset();
      return false;
    }
    return this.failures >= MAX_FAILURES;
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = this.now();
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureAt = 0;
  }
}
