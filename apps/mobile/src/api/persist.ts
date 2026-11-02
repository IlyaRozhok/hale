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
    persistClient: (client: PersistedClient) => store.set(key, JSON.stringify(client)),
    restoreClient: async () => {
      const raw = await store.get(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: () => store.remove(key),
  };
}

/** Only the last good Today response goes to the device; previews and anything else stay in memory. */
export function shouldPersist(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.queryKey[0] === "today" && query.state.status === "success";
}
