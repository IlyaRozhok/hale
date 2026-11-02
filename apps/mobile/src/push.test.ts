import { describe, expect, it, vi } from "vitest";
import { registerPush, PUSH_ASKED_KEY, type PushDeps } from "./push";

function setup(over: Partial<PushDeps> = {}) {
  const data = new Map<string, string>();
  const deps: PushDeps = {
    store: {
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => void data.set(k, v),
      remove: async (k) => void data.delete(k),
    },
    permission: vi.fn(async () => "undetermined" as const),
    request: vi.fn(async () => true),
    token: vi.fn(async () => "ExponentPushToken[abc]"),
    send: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, data };
}

describe("registerPush", () => {
  it("asks once, then sends the token", async () => {
    const { deps, data } = setup();
    await expect(registerPush(deps)).resolves.toBe("sent");
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith("ExponentPushToken[abc]");
    expect(data.get(PUSH_ASKED_KEY)).toBe("1");
  });

  it("does not ask again once asked, even if the system still says undetermined", async () => {
    const { deps } = setup();
    await registerPush(deps);
    await expect(registerPush(deps)).resolves.toBe("skipped");
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it("a refusal is silent and is not asked again", async () => {
    const { deps } = setup({ request: vi.fn(async () => false) });
    await expect(registerPush(deps)).resolves.toBe("denied");
    expect(deps.send).not.toHaveBeenCalled();
    const denied = setup({ permission: vi.fn(async () => "denied" as const) });
    await expect(registerPush(denied.deps)).resolves.toBe("denied");
    expect(denied.deps.request).not.toHaveBeenCalled();
  });

  it("with permission already granted it only retries the token, without a prompt", async () => {
    const { deps } = setup({ permission: vi.fn(async () => "granted" as const) });
    await expect(registerPush(deps)).resolves.toBe("sent");
    expect(deps.request).not.toHaveBeenCalled();
  });

  it("no real token (simulator) or a failing send never throws", async () => {
    const none = setup({ token: vi.fn(async () => null) });
    await expect(registerPush(none.deps)).resolves.toBe("unavailable");
    const throwing = setup({ token: vi.fn(async () => { throw new Error("no projectId"); }) });
    await expect(registerPush(throwing.deps)).resolves.toBe("unavailable");
    const failing = setup({ send: vi.fn(async () => { throw new Error("offline"); }) });
    await expect(registerPush(failing.deps)).resolves.toBe("unavailable");
    const broken = setup({ permission: vi.fn(async () => { throw new Error("native"); }) });
    await expect(registerPush(broken.deps)).resolves.toBe("unavailable");
  });
});
