import { describe, expect, it, vi } from "vitest";
import { MonoClient } from "./mono.client";
import { MonoApiError, MonoResponseError } from "./mono.errors";
import { type Clock, RateGate } from "./rate-gate";

const TOKEN = "u_secret_token_value_123";

/** Fake time: sleeping advances the clock instantly. */
function fakeClock(start = 1_000_000): Clock & { t: number } {
  const c = {
    t: start,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
    },
  };
  return c;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

function setup(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const clock = fakeClock();
  const calls: { url: string; init: RequestInit; at: number }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, at: clock.t });
    return responder(String(url), init ?? {});
  });
  const client = new MonoClient({
    token: TOKEN,
    gate: new RateGate(clock),
    fetch: fetchFn as unknown as typeof fetch,
  });
  return { client, calls, clock, fetchFn };
}

const clientInfoBody = {
  clientId: "c1",
  name: "Test User",
  webHookUrl: "",
  permissions: "psfj",
  accounts: [
    {
      id: "acc1",
      sendId: "s1",
      balance: 1000,
      creditLimit: 500,
      type: "somethingNew",
      currencyCode: 980,
      cashbackType: "UAH",
      maskedPan: ["537541******1234"],
      iban: "UA000000000000000000000000000",
      extraField: true,
    },
  ],
  jars: [
    { id: "j1", sendId: "js", title: "Car", description: "d", currencyCode: 980, balance: 5, goal: 100 },
  ],
};

describe("RateGate", () => {
  it("spaces two acquisitions at least 60 s apart on a fake clock", async () => {
    const clock = fakeClock();
    const gate = new RateGate(clock);
    await gate.acquire();
    const first = clock.t;
    await gate.acquire();
    expect(clock.t - first).toBeGreaterThanOrEqual(60_000);
  });

  it("does not wait when 60 s already passed", async () => {
    const clock = fakeClock();
    const gate = new RateGate(clock);
    await gate.acquire();
    clock.t += 61_000;
    const before = clock.t;
    await gate.acquire();
    expect(clock.t).toBe(before);
  });

  it("serialises concurrent callers", async () => {
    const clock = fakeClock();
    const gate = new RateGate(clock);
    const stamps: number[] = [];
    await Promise.all(
      [1, 2, 3].map(async () => {
        await gate.acquire();
        stamps.push(clock.t);
      }),
    );
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(60_000);
    expect(stamps[2]! - stamps[1]!).toBeGreaterThanOrEqual(60_000);
  });
});

describe("MonoClient", () => {
  it("sends X-Token and parses client-info, keeping unknown account types", async () => {
    const { client, calls } = setup(() => json(clientInfoBody));
    const info = await client.clientInfo();
    expect(calls[0]!.url).toBe("https://api.monobank.ua/personal/client-info");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Token"]).toBe(TOKEN);
    expect(info.accounts[0]!.type).toBe("somethingNew");
    expect(info.jars[0]!.goal).toBe(100);
  });

  it("gates two consecutive private calls by 60 s", async () => {
    const { client, calls } = setup(() => json(clientInfoBody));
    await client.clientInfo();
    await client.clientInfo();
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(60_000);
  });

  it("shares one gate between statement, clientInfo and setWebhook", async () => {
    const { client, calls } = setup((url) =>
      url.includes("statement") ? json([]) : url.includes("webhook") ? json({}) : json(clientInfoBody),
    );
    await client.clientInfo();
    await client.statement("acc1", 1000, 2000);
    await client.setWebhook("https://example.test/hook");
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(60_000);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(60_000);
  });

  it("currency is public: no token, not gated", async () => {
    const { client, calls } = setup(() =>
      json([{ currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 41, rateSell: 42 }, { currencyCodeA: 978, currencyCodeB: 840, date: 1, rateCross: 1.1 }]),
    );
    const rates = await client.currency();
    await client.currency();
    expect(rates).toHaveLength(2);
    expect(rates[1]!.rateCross).toBe(1.1);
    expect(calls[1]!.at).toBe(calls[0]!.at);
    expect(JSON.stringify(calls[0]!.init.headers ?? {})).not.toContain(TOKEN);
  });

  it("throws MonoApiError with status 429 and retryAfter", async () => {
    const { client } = setup(() =>
      json({ errorDescription: "Too many requests" }, { status: 429, headers: { "Retry-After": "30" } }),
    );
    const err = await client.clientInfo().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MonoApiError);
    expect((err as MonoApiError).status).toBe(429);
    expect((err as MonoApiError).retryAfter).toBe(30);
  });

  it("throws MonoApiError on 401", async () => {
    const { client } = setup(() => json({ errorDescription: "Unknown 'X-Token'" }, { status: 401 }));
    const err = await client.clientInfo().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MonoApiError);
    expect((err as MonoApiError).status).toBe(401);
  });

  it("never leaks the token into error text", async () => {
    const { client } = setup(() => json({ errorDescription: `bad ${TOKEN}` }, { status: 403 }));
    const err = (await client.clientInfo().catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(TOKEN);
    expect(String(err.stack)).not.toContain(TOKEN);
  });

  it("never leaks the token when fetch itself fails", async () => {
    const clock = fakeClock();
    const client = new MonoClient({
      token: TOKEN,
      gate: new RateGate(clock),
      fetch: (async () => {
        throw new Error(`socket hang up ${TOKEN}`);
      }) as unknown as typeof fetch,
    });
    const err = (await client.clientInfo().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(TOKEN);
  });

  it("accepts extra fields and missing optional statement fields", async () => {
    const item = {
      id: "t1", time: 1, description: "d", mcc: 5411, originalMcc: 5411, hold: false,
      amount: -100, operationAmount: -100, currencyCode: 980, commissionRate: 0,
      cashbackAmount: 0, balance: 900, surprise: "x",
    };
    const full = { ...item, id: "t2", comment: "c", counterIban: "UA1", counterName: "n", counterEdrpou: "1", receiptId: "r", invoiceId: "i" };
    const { client } = setup(() => json([item, full]));
    const out = await client.statement("acc1", 1000, 2000);
    expect(out[0]!.comment).toBeUndefined();
    expect(out[1]!.counterIban).toBe("UA1");
  });

  it("rejects a statement item without id", async () => {
    const bad = { time: 1, description: "d", mcc: 1, originalMcc: 1, hold: false, amount: 1, operationAmount: 1, currencyCode: 980, commissionRate: 0, cashbackAmount: 0, balance: 1 };
    const { client } = setup(() => json([bad]));
    await expect(client.statement("acc1", 1000, 2000)).rejects.toBeInstanceOf(MonoResponseError);
  });

  it("rejects a statement window above 2,682,000 s before any request", async () => {
    const { client, fetchFn } = setup(() => json([]));
    await expect(client.statement("acc1", 0, 2_682_001)).rejects.toThrow(/window/i);
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(client.statement("acc1", 0, 2_682_000)).resolves.toEqual([]);
  });

  it("builds the statement URL and posts the webhook body", async () => {
    const { client, calls } = setup((url) => (url.includes("webhook") ? json({}) : json([])));
    await client.statement("acc1", 10, 20);
    await client.setWebhook("https://example.test/hook");
    expect(calls[0]!.url).toBe("https://api.monobank.ua/personal/statement/acc1/10/20");
    expect(calls[1]!.url).toBe("https://api.monobank.ua/personal/webhook");
    expect(calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ webHookUrl: "https://example.test/hook" });
  });

  it("throws a clear error when called without a token, before any request", async () => {
    const clock = fakeClock();
    const fetchFn = vi.fn();
    const client = new MonoClient({ token: undefined, gate: new RateGate(clock), fetch: fetchFn as unknown as typeof fetch });
    await expect(client.clientInfo()).rejects.toThrow(/MONOBANK_TOKEN/);
    await expect(client.statement("a", 1, 2)).rejects.toThrow(/MONOBANK_TOKEN/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("request timeout", () => {
  it("passes an abort signal to fetch and treats an abort as a network error", async () => {
    const { client, calls } = setup(async () => json([]));
    await client.currency();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);

    const aborting = setup(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    await expect(aborting.client.currency()).rejects.toThrow(/failed: .*timed out/);
  });
});
