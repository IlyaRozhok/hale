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

  it("sends the USDC answers and the manual balance calls to their routes", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.matchUsdc(12, 34);
    await api.dismissUsdcMatch(34);
    await api.manualBalances();
    await api.patchManualBalance(7, 0);
    await api.createManualBalance({ name: "Binance", amount: 1, currency: "USD" });
    const calls = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [init.method, url.replace("https://api.example.test", ""), init.body]);
    expect(calls).toEqual([
      ["POST", "/plan/incomes/12/match-transaction", JSON.stringify({ transactionId: 34 })],
      ["POST", "/plan/transactions/34/not-usdc", undefined],
      ["GET", "/plan/manual-balances", undefined],
      ["PATCH", "/plan/manual-balances/7", JSON.stringify({ amount: 0 })],
      ["POST", "/plan/manual-balances", JSON.stringify({ name: "Binance", amount: 1, currency: "USD" })],
    ]);
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

  it("sends group and a URL-encoded search with the transactions query", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [], nextCursor: null, dayTotals: {} }));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.transactions({ group: "spend", q: "кафе & co" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(`https://api.example.test/transactions?group=spend&q=${encodeURIComponent("кафе & co")}`);
  });

  it("creates, patches and deletes goals under /plan/goals", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.goals();
    await api.createGoal({ name: "Подушка", target_cents: 500000 });
    await api.patchGoal(3, { saved_cents: 100 });
    await api.deleteGoal(3);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => [i.method ?? "GET", u.replace("https://api.example.test", "")])).toEqual([
      ["GET", "/plan/goals"],
      ["POST", "/plan/goals"],
      ["PATCH", "/plan/goals/3"],
      ["DELETE", "/plan/goals/3"],
    ]);
  });

  it("builds the transactions query and sends edits with PATCH", async () => {
    const fetchImpl = vi.fn(async () => json({ items: [], nextCursor: null, dayTotals: {} }));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.transactions({ cursor: "a b", needsLabel: true });
    await api.transactions({});
    await api.editTransaction(7, { category: "cafe", applyToSimilar: true });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe("https://api.example.test/transactions?cursor=a%20b&needsLabel=true");
    expect(calls[1]![0]).toBe("https://api.example.test/transactions");
    expect(calls[2]![0]).toBe("https://api.example.test/transactions/7");
    expect(calls[2]![1].method).toBe("PATCH");
    expect(calls[2]![1].body).toBe(JSON.stringify({ category: "cafe", applyToSimilar: true }));
  });

  it("covers labels, settings, payments, loans and the push token", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const { api } = setup(fetchImpl as unknown as typeof fetch);
    await api.labelRecipient("0123456789abcdef", "help");
    await api.patchSettings({ limit_visual: "ring" });
    await api.previewSettings(10_000_000);
    await api.markPaid(3);
    await api.deleteLoan(7);
    await api.cancelBridge();
    await api.createLoan({ amount: 500000, received_on: "2026-11-02", note: "x" });
    await api.registerPushToken("ExponentPushToken[abc]");
    await api.repayLoan(7, { amount: 1000, date: "2026-11-02" });
    await api.loanHistory();
    await api.recipient("0123456789abcdef");
    await api.repayOldLoans();
    await api.expectedIncomes();
    await api.createExpectedIncome({ source: "fop", amount: 1, currency: "UAH", window_start_day: 1, window_end_day: 2 });
    await api.patchExpectedIncome(1, { amount: 2 });
    await api.deleteExpectedIncome(1);
    await api.incomeEvents();
    await api.recurring();
    await api.createRecurring({ name: "a", amount: 1, currency: "UAH", day_of_month: 1 });
    await api.patchRecurring(1, { amount: 2 });
    await api.deleteRecurring(1);
    await api.patchPayment(1, { amount: 2 });
    await api.deletePayment(1);
    await api.createInstallment({ name: "a b", amount: 1, currency: "UAH", remaining: 2, first_due: "2026-12-01" });
    await api.patchInstallment("a b", { amount: 2 });
    await api.deleteInstallment("a b");
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => `${i.method} ${u.replace("https://api.example.test", "")}`)).toEqual([
      "POST /recipients/label",
      "PATCH /settings",
      "POST /settings/preview",
      "POST /plan/payments/3/mark-paid",
      "DELETE /plan/loans/7",
      "DELETE /bridge",
      "POST /plan/loans",
      "POST /devices/push-token",
      "POST /plan/loans/7/repay",
      "GET /plan/loans/history",
      "GET /recipients/0123456789abcdef",
      "POST /plan/loans/old/repaid",
      "GET /plan/expected-incomes",
      "POST /plan/expected-incomes",
      "PATCH /plan/expected-incomes/1",
      "DELETE /plan/expected-incomes/1",
      "GET /plan/incomes",
      "GET /plan/recurring",
      "POST /plan/recurring",
      "PATCH /plan/recurring/1",
      "DELETE /plan/recurring/1",
      "PATCH /plan/payments/1",
      "DELETE /plan/payments/1",
      "POST /plan/installments",
      "PATCH /plan/installments/a%20b",
      "DELETE /plan/installments/a%20b",
    ]);
    expect(calls[2]![1].body).toBe(JSON.stringify({ lifestyleCap: 10_000_000 }));
    expect(calls[7]![1].body).toBe(JSON.stringify({ token: "ExponentPushToken[abc]" }));
  });
});
