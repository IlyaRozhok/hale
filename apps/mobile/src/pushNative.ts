import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import type { Api } from "./api/client";
import type { KeyValueStore } from "./api/persist";
import type { PushDeps } from "./push";

/** The expo-notifications side of push registration (see push.ts for the rules). */
export function createPushDeps(api: Pick<Api, "registerPushToken">, store: KeyValueStore): PushDeps {
  return {
    store,
    permission: async () => (await Notifications.getPermissionsAsync()).status,
    request: async () => (await Notifications.requestPermissionsAsync()).status === "granted",
    token: async () => {
      try {
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
        return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
      } catch {
        // A simulator, or a build without an EAS project, has no push token.
        return null;
      }
    },
    send: (token) => api.registerPushToken(token),
  };
}
