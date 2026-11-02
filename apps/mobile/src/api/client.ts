import type { BridgePreviewDto, TodayDto } from "@tablo/contracts";

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
  confirmIncome(eventId: number): Promise<void>;
  setIncomeDate(eventId: number, date: string): Promise<void>;
}

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

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
    confirmIncome: async (eventId) => void (await request("POST", `/plan/incomes/${eventId}/confirm`)),
    setIncomeDate: async (eventId, date) => void (await request("POST", `/plan/incomes/${eventId}/date`, { date })),
  };
}
