// Push registration logic. No native imports: the expo-notifications wiring lives in pushNative.ts.
import type { KeyValueStore } from "./api/persist";

export const PUSH_ASKED_KEY = "tablo.push-asked";

export interface PushDeps {
  store: KeyValueStore;
  permission(): Promise<"granted" | "denied" | "undetermined">;
  request(): Promise<boolean>;
  /** The Expo push token, or null when this device has none (a simulator). */
  token(): Promise<string | null>;
  send(token: string): Promise<void>;
}

/**
 * Asks for notification permission once (a stored flag, set before the prompt), then sends the
 * token to the server. A refusal, a missing token or any failure is silent: it must never break the app.
 */
export async function registerPush(d: PushDeps): Promise<"sent" | "denied" | "skipped" | "unavailable"> {
  try {
    const status = await d.permission();
    if (status === "denied") return "denied";
    if (status === "undetermined") {
      if ((await d.store.get(PUSH_ASKED_KEY)) !== null) return "skipped";
      await d.store.set(PUSH_ASKED_KEY, "1");
      if (!(await d.request())) return "denied";
    }
    const token = await d.token();
    if (!token) return "unavailable";
    await d.send(token);
    return "sent";
  } catch {
    return "unavailable";
  }
}
