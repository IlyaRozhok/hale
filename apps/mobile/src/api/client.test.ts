import { describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, UnauthorizedError, createApi } from "./client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(fetchImpl: typeof fetch, token: string | null = "tok") {
  const onUnauthorized = vi.fn();
  const api = createApi({ baseUrl: "https://api.example.test/", getToken: async () => token, onUnauthorized, fetchImpl });
  return { api, onUnauthorized };
}

describe("api client", () => {
  it("sends the bearer token and parses the Today response", async () => {
    const fetchImpl = vi.fn(async () => json({ date: "2026-11-02" }));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await expect(api.today()).resolves.toEqual({ date: "2026-11-02" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/today");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("posts JSON bodies", async () => {
    const fetchImpl = vi.fn(async () => json({ dailyAmount: 45000, creditNeeded: 1, shortfall: 0 }));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.previewBridge(45000);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/bridge/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ dailyAmount: 45000 }));
  });

  it("login sends no token and returns the token string", async () => {
    const fetchImpl = vi.fn(async () => json({ token: "abc" }));
    const { api } = setup(fetchImpl as unknown as typeof fetch, null);
    await expect(api.login("pw", "iPhone")).resolves.toBe("abc");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("calls onUnauthorized on 401 for authed requests", async () => {
    const { api, onUnauthorized } = setup((async () => json({}, 401)) as unknown as typeof fetch);
    await expect(api.today()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("a 401 on login is a wrong password, not a lost session", async () => {
    const { api, onUnauthorized } = setup((async () => json({}, 401)) as unknown as typeof fetch, null);
    await expect(api.login("bad", "iPhone")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("maps a failed fetch to NetworkError and other statuses to ApiError", async () => {
    const down = setup((async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch);
    await expect(down.api.today()).rejects.toBeInstanceOf(NetworkError);
    const bad = setup((async () => json({}, 500)) as unknown as typeof fetch);
    await expect(bad.api.today()).rejects.toMatchObject({ status: 500 });
    await expect(bad.api.today()).rejects.toBeInstanceOf(ApiError);
  });
});
