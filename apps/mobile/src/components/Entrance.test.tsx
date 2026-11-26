import { render, screen } from "@testing-library/react-native";
import { Animated, StyleSheet, View } from "react-native";
import { watchMotion } from "../testing";
import { Wipe } from "./Entrance";

const shift = () => Number(JSON.stringify((StyleSheet.flatten(screen.getByTestId("wipe").props.style).transform as { translateX: unknown }[])[0]!.translateX));

describe("Wipe (ЧЛ8а)", () => {
  let motion: ReturnType<typeof watchMotion>;
  let interpolate: jest.SpyInstance;
  beforeEach(() => {
    motion = watchMotion();
    interpolate = jest.spyOn(Animated.Value.prototype, "interpolate");
  });
  afterEach(() => {
    interpolate.mockRestore();
    motion.restore();
  });
  const wipe = (span: number, play = 1) => (
    <Wipe testID="wipe" play={play} ms={1000} span={span} over={<View />}>
      <View />
    </Wipe>
  );

  it("drawn again with the same span, it builds no new interpolations and starts nothing again", async () => {
    const { rerender } = await render(wipe(300));
    expect(shift()).toBe(-300);
    const built = interpolate.mock.calls.length;
    expect(built).toBe(3);
    await rerender(wipe(300));
    await rerender(wipe(300));
    expect(interpolate.mock.calls.length).toBe(built);
    expect(motion.asked()).toEqual([{ duration: 1000, delay: 0 }]);
  });

  it("a new span moves the window's start", async () => {
    const { rerender } = await render(wipe(300));
    await rerender(wipe(500));
    expect(shift()).toBe(-500);
  });
});
