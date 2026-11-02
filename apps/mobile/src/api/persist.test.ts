import { describe, expect, it } from "vitest";
import { createStorePersister, shouldPersist, type KeyValueStore } from "./persist";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

const client = { timestamp: 1, buster: "", clientState: { mutations: [], queries: [] } };

describe("store persister", () => {
  it("round-trips and removes", async () => {
    const store = memory();
    const p = createStorePersister(store, "key");
    expect(await p.restoreClient()).toBeUndefined();
    await p.persistClient(client);
    expect(await p.restoreClient()).toEqual(client);
    await p.removeClient();
    expect(store.data.size).toBe(0);
  });

  it("ignores a corrupt entry", async () => {
    const store = memory();
    store.data.set("key", "{not json");
    expect(await createStorePersister(store, "key").restoreClient()).toBeUndefined();
  });
});

describe("shouldPersist", () => {
  it("keeps only a successful Today query", () => {
    const q = (key: unknown[], status: string) => ({ queryKey: key, state: { status } }) as never;
    expect(shouldPersist(q(["today"], "success"))).toBe(true);
    expect(shouldPersist(q(["today"], "error"))).toBe(false);
    expect(shouldPersist(q(["bridge-preview", 1], "success"))).toBe(false);
  });
});
