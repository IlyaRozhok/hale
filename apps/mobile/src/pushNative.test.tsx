import * as Notifications from "expo-notifications";
import { createPushDeps } from "./pushNative";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "proj-1" } } } } }));

const n = Notifications as unknown as Record<"getPermissionsAsync" | "requestPermissionsAsync" | "getExpoPushTokenAsync", jest.Mock>;
const api = { registerPushToken: jest.fn(async () => undefined) };
const store = { get: jest.fn(), set: jest.fn(), remove: jest.fn() };

describe("createPushDeps", () => {
  it("maps system permission to the three states and requests through the system prompt", async () => {
    const deps = createPushDeps(api, store);
    n.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    await expect(deps.permission()).resolves.toBe("granted");
    n.getPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    await expect(deps.permission()).resolves.toBe("denied");
    n.getPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });
    await expect(deps.permission()).resolves.toBe("undetermined");
    n.requestPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    await expect(deps.request()).resolves.toBe(true);
    n.requestPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    await expect(deps.request()).resolves.toBe(false);
  });

  it("fetches the Expo token for the project and posts it to the server", async () => {
    const deps = createPushDeps(api, store);
    n.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[abc]" });
    await expect(deps.token()).resolves.toBe("ExponentPushToken[abc]");
    expect(n.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-1" });
    await deps.send("ExponentPushToken[abc]");
    expect(api.registerPushToken).toHaveBeenCalledWith("ExponentPushToken[abc]");
  });

  it("a simulator has no token: the call throws and that is reported as no token", async () => {
    const deps = createPushDeps(api, store);
    n.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("no device"));
    await expect(deps.token()).resolves.toBeNull();
  });
});
