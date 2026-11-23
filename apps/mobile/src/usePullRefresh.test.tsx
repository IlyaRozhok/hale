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

  it("gives back only what a RefreshControl takes, so screens can spread it", async () => {
    const { result } = await renderHook(() => usePullRefresh(() => Promise.resolve()));
    expect(Object.keys(result.current).sort()).toEqual(["onRefresh", "refreshing"]);
  });

  // Я1: a pull belongs to the list it was made on. When the list changes under it, the spinner goes, and the old
  // refetch answering later does not touch a pull made on the new list.
  describe("when the list it pulled changes", () => {
    it("stops the spinner at once, though the old refetch has not answered", async () => {
      let answer = () => {};
      const refetch = () => new Promise<void>((r) => (answer = r));
      const { result, rerender } = await renderHook(({ of }: { of: string }) => usePullRefresh(refetch, of), { initialProps: { of: "all" } });
      await act(async () => result.current.onRefresh());
      expect(result.current.refreshing).toBe(true);
      await rerender({ of: "groceries" });
      expect(result.current.refreshing).toBe(false);
      await act(async () => answer());
      expect(result.current.refreshing).toBe(false);
    });

    it("does not bring the old spinner back on returning to that list", async () => {
      const refetch = () => new Promise<void>(() => {});
      const { result, rerender } = await renderHook(({ of }: { of: string }) => usePullRefresh(refetch, of), { initialProps: { of: "all" } });
      await act(async () => result.current.onRefresh());
      await rerender({ of: "groceries" });
      await rerender({ of: "all" });
      expect(result.current.refreshing).toBe(false);
    });

    it("a new pull is not ended by the old one answering late", async () => {
      const answers: (() => void)[] = [];
      const refetch = () => new Promise<void>((r) => answers.push(r));
      const { result, rerender } = await renderHook(({ of }: { of: string }) => usePullRefresh(refetch, of), { initialProps: { of: "all" } });
      await act(async () => result.current.onRefresh());
      await rerender({ of: "groceries" });
      await act(async () => result.current.onRefresh());
      await act(async () => answers[0]!());
      expect(result.current.refreshing).toBe(true);
      await act(async () => answers[1]!());
      expect(result.current.refreshing).toBe(false);
    });
  });
});
