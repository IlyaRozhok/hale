import { describe, expect, it } from "vitest";
import { LoginThrottle } from "./login-throttle";

describe("LoginThrottle", () => {
  it("locks after 5 consecutive failures and unlocks after 15 minutes", () => {
    let t = 1_000;
    const th = new LoginThrottle(() => t);
    for (let i = 0; i < 5; i++) {
      expect(th.isLocked()).toBe(false);
      th.recordFailure();
    }
    expect(th.isLocked()).toBe(true);
    t += 14 * 60_000;
    expect(th.isLocked()).toBe(true);
    t += 61_000;
    expect(th.isLocked()).toBe(false);
  });

  it("reset clears the counter", () => {
    const th = new LoginThrottle(() => 0);
    for (let i = 0; i < 4; i++) th.recordFailure();
    th.reset();
    th.recordFailure();
    expect(th.isLocked()).toBe(false);
  });
});
