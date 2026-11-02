import * as SecureStore from "expo-secure-store";
import type { KeyValueStore } from "./persist";

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** The iOS Keychain: encrypted at rest, kept off backups and other devices. */
export const keychain: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export const TOKEN_KEY = "tablo.token";
export const CACHE_KEY = "tablo.today-cache";
