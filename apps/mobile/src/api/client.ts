import type {
  BridgePreviewDto,
  GoalDto,
  GoalInput,
  GoalPatch,
  LoanInput,
  ManualBalanceDto,
  ManualBalanceInput,
  RecipientLabelName,
  RecipientLabelResultDto,
  ScheduledPaymentDto,
  ScheduledPaymentInput,
  SettingsDto,
  SettingsPatch,
  SettingsPreviewDto,
  TodayDto,
  TransactionEditDto,
  TransactionPageDto,
  TransactionPatch,
} from "@hale/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message = `request failed with status ${status}`,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 401: no token, or the server no longer accepts it. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, "unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** The request never got an answer: offline, DNS, timeout. */
export class NetworkError extends Error {
  constructor() {
    super("network unavailable");
    this.name = "NetworkError";
  }
}

export interface Api {
  login(password: string, deviceName: string): Promise<string>;
  today(): Promise<TodayDto>;
  previewBridge(dailyAmount: number): Promise<BridgePreviewDto>;
  chooseBridge(dailyAmount: number): Promise<TodayDto>;
  cancelBridge(): Promise<TodayDto>;
  confirmIncome(eventId: number): Promise<void>;
  setIncomeDate(eventId: number, date: string): Promise<void>;
  matchUsdc(eventId: number, transactionId: number): Promise<void>;
  dismissUsdcMatch(transactionId: number): Promise<void>;
  manualBalances(): Promise<ManualBalanceDto[]>;
  createManualBalance(input: ManualBalanceInput): Promise<ManualBalanceDto>;
  patchManualBalance(id: number, amount: number): Promise<ManualBalanceDto>;
  transactions(query: TransactionsFilter & { cursor?: string }): Promise<TransactionPageDto>;
  editTransaction(id: number, patch: Pick<TransactionPatch, "type" | "category" | "applyToSimilar">): Promise<TransactionEditDto>;
  labelRecipient(counterKey: string, label: RecipientLabelName): Promise<RecipientLabelResultDto>;
  settings(): Promise<SettingsDto>;
  patchSettings(patch: SettingsPatch): Promise<SettingsDto>;
  previewSettings(lifestyleCap: number): Promise<SettingsPreviewDto>;
  payments(): Promise<ScheduledPaymentDto[]>;
  createPayment(input: ScheduledPaymentInput): Promise<ScheduledPaymentDto>;
  markPaid(id: number): Promise<void>;
  createLoan(input: LoanInput): Promise<void>;
  deleteLoan(id: number): Promise<void>;
  registerPushToken(token: string): Promise<void>;
  goals(): Promise<GoalDto[]>;
  createGoal(input: GoalInput): Promise<GoalDto>;
  patchGoal(id: number, patch: GoalPatch): Promise<GoalDto>;
  deleteGoal(id: number): Promise<void>;
}

export type TransactionsFilter = { needsLabel?: boolean; group?: "spend" | "income" | "all"; q?: string };

export interface ApiOptions {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Called when an authenticated request gets 401, so the app can drop the token. */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

/** Thin typed client. Never logs bodies: they hold financial data. */
export function createApi({ baseUrl, getToken, onUnauthorized, fetchImpl = fetch }: ApiOptions): Api {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401) {
      if (token) onUnauthorized();
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new ApiError(res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    login: async (password, deviceName) => (await request<{ token: string }>("POST", "/auth/login", { password, deviceName })).token,
    today: () => request("GET", "/today"),
    previewBridge: (dailyAmount) => request("POST", "/bridge/preview", { dailyAmount }),
    chooseBridge: (dailyAmount) => request("POST", "/bridge", { dailyAmount }),
    cancelBridge: () => request("DELETE", "/bridge"),
    confirmIncome: async (eventId) => void (await request("POST", `/plan/incomes/${eventId}/confirm`)),
    setIncomeDate: async (eventId, date) => void (await request("POST", `/plan/incomes/${eventId}/date`, { date })),
    matchUsdc: async (eventId, transactionId) => void (await request("POST", `/plan/incomes/${eventId}/match-transaction`, { transactionId })),
    dismissUsdcMatch: async (transactionId) => void (await request("POST", `/plan/transactions/${transactionId}/not-usdc`)),
    manualBalances: () => request("GET", "/plan/manual-balances"),
    createManualBalance: (input) => request("POST", "/plan/manual-balances", input),
    patchManualBalance: (id, amount) => request("PATCH", `/plan/manual-balances/${id}`, { amount }),
    goals: () => request("GET", "/plan/goals"),
    createGoal: (input) => request("POST", "/plan/goals", input),
    patchGoal: (id, patch) => request("PATCH", `/plan/goals/${id}`, patch),
    deleteGoal: async (id) => void (await request("DELETE", `/plan/goals/${id}`)),
    transactions: ({ cursor, needsLabel, group, q: search }) => {
      const q = [
        group !== undefined && `group=${group}`,
        search !== undefined && `q=${encodeURIComponent(search)}`,
        cursor !== undefined && `cursor=${encodeURIComponent(cursor)}`,
        needsLabel !== undefined && `needsLabel=${needsLabel}`,
      ].filter(Boolean);
      return request("GET", `/transactions${q.length ? `?${q.join("&")}` : ""}`);
    },
    editTransaction: (id, patch) => request("PATCH", `/transactions/${id}`, patch),
    labelRecipient: (counterKey, label) => request("POST", "/recipients/label", { counterKey, label }),
    settings: () => request("GET", "/settings"),
    patchSettings: (patch) => request("PATCH", "/settings", patch),
    previewSettings: (lifestyleCap) => request("POST", "/settings/preview", { lifestyleCap }),
    payments: () => request("GET", "/plan/payments"),
    createPayment: (input) => request("POST", "/plan/payments", input),
    markPaid: async (id) => void (await request("POST", `/plan/payments/${id}/mark-paid`)),
    createLoan: async (input) => void (await request("POST", "/plan/loans", input)),
    deleteLoan: async (id) => void (await request("DELETE", `/plan/loans/${id}`)),
    registerPushToken: async (token) => void (await request("POST", "/devices/push-token", { token })),
  };
}
