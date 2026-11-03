import type {
  BridgePreviewDto,
  CalendarDto,
  ExpectedIncomeDto,
  ExpectedIncomeInput,
  ExpectedIncomePatch,
  GoalDto,
  GoalInput,
  GoalPatch,
  IncomeEventDto,
  InstallmentInput,
  InstallmentPatch,
  LoanHistoryDto,
  LoanInput,
  LoanRepayInput,
  ManualBalanceDto,
  ManualBalanceInput,
  RecipientLabelName,
  RecipientLabelResultDto,
  RecipientSummaryDto,
  RecurringDto,
  RecurringInput,
  RecurringPatch,
  ScheduledPaymentDto,
  ScheduledPaymentInput,
  ScheduledPaymentPatch,
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
  calendar(month: string): Promise<CalendarDto>;
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
  recipient(counterKey: string): Promise<RecipientSummaryDto>;
  settings(): Promise<SettingsDto>;
  patchSettings(patch: SettingsPatch): Promise<SettingsDto>;
  previewSettings(lifestyleCap: number): Promise<SettingsPreviewDto>;
  payments(): Promise<ScheduledPaymentDto[]>;
  createPayment(input: ScheduledPaymentInput): Promise<ScheduledPaymentDto>;
  markPaid(id: number): Promise<void>;
  createLoan(input: LoanInput): Promise<void>;
  deleteLoan(id: number): Promise<void>;
  repayLoan(id: number, input: LoanRepayInput): Promise<void>;
  loanHistory(): Promise<LoanHistoryDto>;
  repayOldLoans(): Promise<void>;
  expectedIncomes(): Promise<ExpectedIncomeDto[]>;
  createExpectedIncome(input: ExpectedIncomeInput): Promise<void>;
  patchExpectedIncome(id: number, patch: ExpectedIncomePatch): Promise<void>;
  deleteExpectedIncome(id: number): Promise<void>;
  incomeEvents(): Promise<IncomeEventDto[]>;
  recurring(): Promise<RecurringDto[]>;
  createRecurring(input: RecurringInput): Promise<void>;
  patchRecurring(id: number, patch: RecurringPatch): Promise<void>;
  deleteRecurring(id: number): Promise<void>;
  patchPayment(id: number, patch: ScheduledPaymentPatch): Promise<void>;
  deletePayment(id: number): Promise<void>;
  createInstallment(input: InstallmentInput): Promise<void>;
  patchInstallment(name: string, patch: InstallmentPatch): Promise<void>;
  deleteInstallment(name: string): Promise<void>;
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
    calendar: (month) => request("GET", `/today/calendar?month=${month}`),
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
    recipient: (counterKey) => request("GET", `/recipients/${counterKey}`),
    settings: () => request("GET", "/settings"),
    patchSettings: (patch) => request("PATCH", "/settings", patch),
    previewSettings: (lifestyleCap) => request("POST", "/settings/preview", { lifestyleCap }),
    payments: () => request("GET", "/plan/payments"),
    createPayment: (input) => request("POST", "/plan/payments", input),
    markPaid: async (id) => void (await request("POST", `/plan/payments/${id}/mark-paid`)),
    createLoan: async (input) => void (await request("POST", "/plan/loans", input)),
    deleteLoan: async (id) => void (await request("DELETE", `/plan/loans/${id}`)),
    repayLoan: async (id, input) => void (await request("POST", `/plan/loans/${id}/repay`, input)),
    loanHistory: () => request("GET", "/plan/loans/history"),
    repayOldLoans: async () => void (await request("POST", "/plan/loans/old/repaid")),
    expectedIncomes: () => request("GET", "/plan/expected-incomes"),
    createExpectedIncome: async (input) => void (await request("POST", "/plan/expected-incomes", input)),
    patchExpectedIncome: async (id, patch) => void (await request("PATCH", `/plan/expected-incomes/${id}`, patch)),
    deleteExpectedIncome: async (id) => void (await request("DELETE", `/plan/expected-incomes/${id}`)),
    incomeEvents: () => request("GET", "/plan/incomes"),
    recurring: () => request("GET", "/plan/recurring"),
    createRecurring: async (input) => void (await request("POST", "/plan/recurring", input)),
    patchRecurring: async (id, patch) => void (await request("PATCH", `/plan/recurring/${id}`, patch)),
    deleteRecurring: async (id) => void (await request("DELETE", `/plan/recurring/${id}`)),
    patchPayment: async (id, patch) => void (await request("PATCH", `/plan/payments/${id}`, patch)),
    deletePayment: async (id) => void (await request("DELETE", `/plan/payments/${id}`)),
    createInstallment: async (input) => void (await request("POST", "/plan/installments", input)),
    patchInstallment: async (name, patch) => void (await request("PATCH", `/plan/installments/${encodeURIComponent(name)}`, patch)),
    deleteInstallment: async (name) => void (await request("DELETE", `/plan/installments/${encodeURIComponent(name)}`)),
    registerPushToken: async (token) => void (await request("POST", "/devices/push-token", { token })),
  };
}
