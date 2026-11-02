import type { z } from "zod";
import { MonoApiError, MonoResponseError } from "./mono.errors";
import {
  type MonoClientInfo,
  type MonoRate,
  type MonoStatementItem,
  monoClientInfoSchema,
  monoRatesSchema,
  monoStatementSchema,
} from "./mono.schemas";
import { RateGate } from "./rate-gate";

export const MONO_BASE_URL = "https://api.monobank.ua";
/** 31 days + 1 hour, in seconds. */
export const MONO_MAX_STATEMENT_WINDOW_S = 2_682_000;

export interface MonoClientOptions {
  /** From config; optional at boot, required when a private call is made. */
  token: string | undefined;
  gate?: RateGate;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export class MonoClient {
  private readonly token: string | undefined;
  private readonly gate: RateGate;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(opts: MonoClientOptions) {
    this.token = opts.token || undefined;
    this.gate = opts.gate ?? new RateGate();
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = opts.baseUrl ?? MONO_BASE_URL;
  }

  async clientInfo(): Promise<MonoClientInfo> {
    const token = this.requireToken();
    await this.gate.acquire();
    return this.request("/personal/client-info", monoClientInfoSchema, { token });
  }

  /** `from`/`to` are unix seconds. */
  async statement(accountId: string, from: number, to: number): Promise<MonoStatementItem[]> {
    if (to < from) throw new Error("Statement window is invalid: to is before from");
    if (to - from > MONO_MAX_STATEMENT_WINDOW_S) {
      throw new Error(
        `Statement window of ${to - from} s exceeds the ${MONO_MAX_STATEMENT_WINDOW_S} s limit`,
      );
    }
    const token = this.requireToken();
    await this.gate.acquire();
    const path = `/personal/statement/${encodeURIComponent(accountId)}/${from}/${to}`;
    return this.request(path, monoStatementSchema, { token });
  }

  async setWebhook(webHookUrl: string): Promise<void> {
    const token = this.requireToken();
    await this.gate.acquire();
    await this.request("/personal/webhook", null, {
      token,
      method: "POST",
      body: JSON.stringify({ webHookUrl }),
    });
  }

  /** Public endpoint: no token, not rate gated. */
  async currency(): Promise<MonoRate[]> {
    return this.request("/bank/currency", monoRatesSchema, {});
  }

  private requireToken(): string {
    if (!this.token) {
      throw new Error("MONOBANK_TOKEN is not configured; set it to call monobank");
    }
    return this.token;
  }

  private redact(text: string, token?: string): string {
    return token ? text.split(token).join("[redacted]") : text;
  }

  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    opts: { token?: string; method?: string; body?: string },
  ): Promise<z.infer<S>>;
  private async request(
    path: string,
    schema: null,
    opts: { token?: string; method?: string; body?: string },
  ): Promise<void>;
  private async request(
    path: string,
    schema: z.ZodType | null,
    opts: { token?: string; method?: string; body?: string },
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (opts.token) headers["X-Token"] = opts.token;
    if (opts.body) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "unknown error";
      // The original error is deliberately not attached as `cause`: it may embed the token.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`monobank request to ${path} failed: ${this.redact(reason, opts.token)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retry = Number(res.headers.get("Retry-After"));
      throw new MonoApiError(
        this.redact(`monobank ${path} responded ${res.status}: ${text.slice(0, 200)}`, opts.token),
        res.status,
        Number.isFinite(retry) && res.headers.get("Retry-After") !== null ? retry : undefined,
      );
    }
    if (!schema) return undefined;

    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) {
      const details = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new MonoResponseError(`monobank ${path} returned an unexpected shape: ${details}`);
    }
    return parsed.data;
  }
}
