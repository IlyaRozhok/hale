import { act, renderHook } from "@testing-library/react-native";
import { usePullRefresh } from "./usePullRefresh";

describe("usePullRefresh", () => {
  it("clears the spinner and swallows a failed refetch", async () => {
    const { result } = await renderHook(() => usePullRefresh(() => Promise.reject(new Error("offline"))));
    await act(async () => {
      result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(false);
  });
});
