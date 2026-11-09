import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Canvas, LinearGradient, RoundedRect, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { tokens } from "@hale/tokens";
import { useMetalClock } from "./useMetalClock";
import { useAppActive, useReduceMotion } from "./useMetalActive";

const { color, metal } = tokens;
const STOPS = [color.metalBar.shade, color.metalBar.body, color.metalBar.glint, color.metalBar.body, color.metalBar.shade];

type Props = {
  /** Share of the daily limit left, 0..1. Out-of-range and NaN are clamped. */
  level: number;
};

/**
 * The limit as a thin strip of brushed silver over a dark track: the metal covers the share that is
 * left, and one soft highlight glides slowly along it. A gradient, not the pool's shader: at this
 * height the shader's folds turn into grain. Still in the background and under reduce-motion.
 */
export function MetalBar({ level }: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReduceMotion();
  const active = useAppActive();
  const { time, shown } = useMetalClock(level, active && !reduced, reduced);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View style={styles.track} onLayout={onLayout} pointerEvents="none">
      {width > 0 && (
        <Canvas style={{ width, height: metal.barHeight }}>
          <Strip width={width} time={time} level={shown} />
        </Canvas>
      )}
    </View>
  );
}

function Strip({ width, time, level }: { width: number; time: SharedValue<number>; level: SharedValue<number> }) {
  const h = metal.barHeight;
  const filled = useDerivedValue(() => Math.max(0, width * level.value));
  // The glint travels the strip's width and back to the start, at barSpeed widths per second.
  const start = useDerivedValue(() => {
    const span = Math.max(1, filled.value);
    const x = ((time.value * metal.barSpeed) % 2) * span - span;
    return vec(x, 0);
  });
  const end = useDerivedValue(() => vec(start.value.x + Math.max(1, filled.value), 0));
  return (
    <RoundedRect x={0} y={0} width={filled} height={h} r={h / 2}>
      <LinearGradient start={start} end={end} colors={STOPS} mode="mirror" />
    </RoundedRect>
  );
}

const styles = StyleSheet.create({
  track: { height: metal.barHeight, borderRadius: metal.barHeight / 2, overflow: "hidden", backgroundColor: color.data.track },
});
