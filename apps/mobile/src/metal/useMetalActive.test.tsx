import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

type Module = typeof import("./useMetalActive");

/**
 * The module as the app has it (jest.setup replaces its hook for the other tests), loaded afresh: it asks at load.
 * React and React Native stay the test's own copies, so the hook runs in the test's renderer.
 */
const load = (): Module => {
  let loaded: Module | undefined;
  const react = jest.requireActual("react");
  const native = jest.requireActual("react-native");
  jest.isolateModules(() => {
    jest.doMock("react", () => react);
    jest.doMock("react-native", () => native);
    loaded = jest.requireActual<Module>("./useMetalActive");
  });
  return loaded!;
};

describe("useReduceMotion", () => {
  let changed: ((reduced: boolean) => void) | undefined;
  let answer: (reduced: boolean) => void;
  let fail: () => void;

  beforeEach(() => {
    changed = undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(
      () =>
        new Promise<boolean>((resolve, reject) => {
          answer = resolve;
          fail = () => reject(new Error("no answer"));
        }),
    );
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, handler: (reduced: boolean) => void) => {
      if (name === "reduceMotionChanged") changed = handler;
      return { remove: () => undefined };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("asks when the module loads, not when a screen first needs it", () => {
    load();
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  });

  it("counts as reduced until the answer is known", async () => {
    const { useReduceMotion } = load();
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
    await act(async () => answer(false));
    expect(result.current).toBe(false);
  });

  it("a screen mounted after the answer has it on its first render", async () => {
    const { useReduceMotion } = load();
    await act(async () => answer(false));
    const seen: boolean[] = [];
    await renderHook(() => seen.push(useReduceMotion()));
    expect(seen).toEqual([false]);
  });

  it("stays reduced when the system says so", async () => {
    const { useReduceMotion } = load();
    await act(async () => answer(true));
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
  });

  it("with no answer at all, motion is allowed, as before", async () => {
    const { useReduceMotion } = load();
    const { result } = await renderHook(() => useReduceMotion());
    await act(async () => fail());
    expect(result.current).toBe(false);
  });

  it("follows the setting when it changes, and a late first answer does not undo the change", async () => {
    const { useReduceMotion } = load();
    const { result } = await renderHook(() => useReduceMotion());
    await act(async () => changed!(true));
    await act(async () => answer(false));
    expect(result.current).toBe(true);
    await act(async () => changed!(false));
    expect(result.current).toBe(false);
  });
});
