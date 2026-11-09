import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Group, rect, rrect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import { tokens } from "@hale/tokens";
import { HalfResCanvas, MetalFill } from "./HalfResCanvas";
import { useMetalClock } from "./useMetalClock";
import { useAppActive, useReduceMotion } from "./useMetalActive";

const { color, metal } = tokens;

type Props = {
  /** Share of the daily limit left, 0..1. Out-of-range and NaN are clamped. */
  level: number;
};

/**
 * The limit as a thin strip of liquid metal over a dark track: the metal covers the share that is
 * left. It shimmers slowly, a quarter of the pool's pace, and stands still in the background and
 * under reduce-motion.
 */
export function MetalBar({ level }: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReduceMotion();
  const active = useAppActive();
  const { time, shown } = useMetalClock(level, active && !reduced, reduced);
  const slow = useDerivedValue(() => time.value * metal.barSpeed);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View style={styles.track} onLayout={onLayout} pointerEvents="none">
      {width > 0 && (
        <HalfResCanvas width={width} height={metal.barHeight}>
          {(s) => <Strip width={s.width} height={s.height} time={slow} level={shown} />}
        </HalfResCanvas>
      )}
    </View>
  );
}

function Strip({ width, height, time, level }: { width: number; height: number; time: Parameters<typeof MetalFill>[0]["time"]; level: Parameters<typeof MetalFill>[0]["level"] }) {
  const clip = useDerivedValue(() => rrect(rect(0, 0, width * level.value, height), height / 2, height / 2));
  const full = useDerivedValue(() => 1);
  return (
    <Group clip={clip}>
      <MetalFill width={width} height={height} time={time} level={full} pool={false} />
    </Group>
  );
}

const styles = StyleSheet.create({
  track: { height: metal.barHeight, borderRadius: metal.barHeight / 2, overflow: "hidden", backgroundColor: color.data.track },
});
