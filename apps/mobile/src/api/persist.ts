import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** A TanStack Query persister over any small key-value store (the Keychain in the app). */
export function createStorePersister(store: KeyValueStore, key: string): Persister {
  return {
    // The cache is a convenience: a failing store must never break the screen.
    persistClient: async (client: PersistedClient) => {
      try {
        await store.set(key, JSON.stringify(client));
      } catch {
        // ignored
      }
    },
    restoreClient: async () => {
      try {
        const raw = await store.get(key);
        return raw === null ? undefined : (JSON.parse(raw) as PersistedClient);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await store.remove(key);
      } catch {
        // ignored
      }
    },
  };
}

/** Only the last good Today response goes to the device; previews and anything else stay in memory. */
export function shouldPersist(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.queryKey[0] === "today" && query.state.status === "success";
}
