import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ENTRANCE } from "./entrance";
import { allowMotion, passTime } from "./testing";
import { useCountUp, useEntrance } from "./useEntrance";

type Of = Parameters<typeof useEntrance>[0];
const of = (over: Partial<Of> = {}): Of => ({ shown: true, stamp: 1, pulling: false, fetching: false, ...over });
const loading = of({ shown: false, stamp: 0, fetching: true });

describe("useEntrance", () => {
  let reduceAgain: () => void;
  beforeEach(() => {
    reduceAgain = allowMotion();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    reduceAgain();
  });
  const mount = (first: Of) => renderHook((props: Of) => useEntrance(props), { initialProps: first });
  const settle = () => act(async () => void jest.advanceTimersByTime(ENTRANCE.settleMs));

  it("gives a key in the very render that first has the data, and 0 before it", async () => {
    const keys: number[] = [];
    const { rerender } = await renderHook((props: Of) => keys.push(useEntrance(props)), { initialProps: loading });
    expect(keys.at(-1)).toBe(0);
    const before = keys.length;
    await rerender(of());
    // Not one render with the data and no key: the sections would draw their final state for a frame.
    expect(keys.slice(before).every((key) => key === 1)).toBe(true);
  });

  it("gives a key at once when it mounts with data already there", async () => {
    const keys: number[] = [];
    await renderHook((props: Of) => keys.push(useEntrance(props)), { initialProps: of() });
    expect(keys[0]).toBe(1);
  });

  it("the key goes back to 0 once the entrance is over, and stays there", async () => {
    const { result, rerender } = await mount(of());
    await act(async () => void jest.advanceTimersByTime(ENTRANCE.settleMs - 1));
    expect(result.current).toBe(1);
    await act(async () => void jest.advanceTimersByTime(1));
    expect(result.current).toBe(0);
    await rerender(of());
    expect(result.current).toBe(0);
  });

  it("no key on a re-render, a background refetch or its new data", async () => {
    const { result, rerender } = await mount(of());
    await settle();
    await rerender(of({ fetching: true }));
    await rerender(of({ stamp: 2 }));
    expect(result.current).toBe(0);
  });

  it("a new key when a pull brings new data", async () => {
    const { result, rerender } = await mount(of());
    await settle();
    await rerender(of({ pulling: true, fetching: true }));
    expect(result.current).toBe(0);
    await rerender(of({ stamp: 2 }));
    expect(result.current).toBe(2);
    await settle();
    expect(result.current).toBe(0);
  });

  it("no key after a failed pull", async () => {
    const { result, rerender } = await mount(of());
    await settle();
    await rerender(of({ pulling: true, fetching: true }));
    await rerender(of());
    await rerender(of({ stamp: 2 }));
    expect(result.current).toBe(0);
  });

  it("no key under reduce motion: not for the first data, not for a pull", async () => {
    reduceAgain();
    const { result, rerender } = await mount(loading);
    await rerender(of());
    expect(result.current).toBe(0);
    await rerender(of({ pulling: true, fetching: true }));
    await rerender(of({ stamp: 2 }));
    expect(result.current).toBe(0);
  });

  it("reduce motion turned on in the middle of an entrance takes the key away", async () => {
    const { result, rerender } = await mount(of());
    expect(result.current).toBe(1);
    reduceAgain();
    await rerender(of());
    expect(result.current).toBe(0);
  });
});

describe("useCountUp", () => {
  const mount = (to: number, play: number) => renderHook(({ to, play }: { to: number; play: number }) => useCountUp(to, play), { initialProps: { to, play } });

  it("is just the amount while the key is 0", async () => {
    const { result, rerender } = await mount(72_000, 0);
    expect(result.current).toBeNull();
    await rerender({ to: 80_000, play: 0 });
    expect(result.current).toBeNull();
  });

  it("starts from zero in the very render the key comes, counts up and ends as the amount itself", async () => {
    const seen: (number | null)[] = [];
    const { rerender } = await renderHook(({ to, play }: { to: number; play: number }) => seen.push(useCountUp(to, play)), { initialProps: { to: 72_000, play: 0 } });
    const before = seen.length;
    await rerender({ to: 72_000, play: 1 });
    expect(seen[before]).toBe(0);
    await waitFor(() => expect(seen.at(-1)).toBeNull(), { timeout: 3000 });
    const way = seen.slice(before, -1) as number[];
    expect(way.length).toBeGreaterThan(2);
    way.forEach((v, i) => {
      expect(v).toBeLessThanOrEqual(72_000);
      expect(v).toBeGreaterThanOrEqual(way[i - 1] ?? 0);
    });
  });

  it("starts from zero when it mounts with a key", async () => {
    const { result } = await mount(72_000, 1);
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBeNull(), { timeout: 3000 });
  });

  it("has nothing to count for zero", async () => {
    const { result } = await mount(0, 1);
    expect(result.current).toBeNull();
  });

  it("is the amount at once when the key goes back to 0", async () => {
    const { result, rerender } = await mount(72_000, 1);
    await rerender({ to: 72_000, play: 0 });
    expect(result.current).toBeNull();
  });

  it("asks for no more frames once it has ended", async () => {
    const { result } = await mount(72_000, 1);
    await waitFor(() => expect(result.current).toBeNull(), { timeout: 3000 });
    const frames = jest.spyOn(globalThis, "requestAnimationFrame");
    await passTime(100);
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });
});
