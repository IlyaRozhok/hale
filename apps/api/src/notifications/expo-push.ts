import { Inject, Injectable, Logger } from "@nestjs/common";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Injection token for the HTTP client, so tests never reach the real Expo endpoint. */
export const EXPO_FETCH = Symbol("EXPO_FETCH");

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface PushResult {
  token: string;
  ok: boolean;
  /** Expo said the token is dead (`DeviceNotRegistered`): the caller clears it. */
  deviceNotRegistered: boolean;
  error?: string;
}

interface Ticket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/** Sends one message to a list of Expo push tokens and reports each ticket on its own. */
@Injectable()
export class ExpoPush {
  private readonly log = new Logger(ExpoPush.name);

  constructor(@Inject(EXPO_FETCH) private readonly fetchFn: FetchLike) {}

  async send(tokens: string[], message: { title: string; body: string }): Promise<PushResult[]> {
    if (tokens.length === 0) return [];
    const fail = (error: string): PushResult[] =>
      tokens.map((token) => ({ token, ok: false, deviceNotRegistered: false, error }));
    try {
      const res = await this.fetchFn(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(tokens.map((to) => ({ to, sound: "default", title: message.title, body: message.body }))),
      });
      if (!res.ok) return fail(`expo responded ${res.status}`);
      const data = ((await res.json()) as { data?: Ticket[] }).data;
      if (!Array.isArray(data) || data.length !== tokens.length) return fail("unexpected expo response");
      return tokens.map((token, i): PushResult => {
        const t = data[i]!;
        if (t.status === "ok") return { token, ok: true, deviceNotRegistered: false };
        const error = t.details?.error ?? t.message ?? "unknown error";
        return { token, ok: false, deviceNotRegistered: t.details?.error === "DeviceNotRegistered", error };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`expo push failed: ${msg}`);
      return fail(msg);
    }
  }
}
