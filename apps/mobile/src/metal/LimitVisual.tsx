import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Mercury } from "./Mercury";
import { Ring } from "./Ring";
import { useMetalClock } from "./useMetalClock";
import { useAppActive, useReduceMotion } from "./useMetalActive";

export type LimitMode = "mercury" | "ring";

type Props = {
  mode: LimitMode;
  /** Share of the daily limit left, 0..1. Out-of-range and NaN are clamped. */
  level: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * The one liquid-metal visual. Fills its parent: mercury uses the whole box, ring the largest
 * centred square. Animation stops in the background and under reduce-motion.
 */
export function LimitVisual({ mode, level, style }: Props) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const reduced = useReduceMotion();
  const active = useAppActive();
  const { time, shown } = useMetalClock(level, active && !reduced, reduced);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width: Math.round(width), height: Math.round(height) });
  };
  const ready = box.width > 0 && box.height > 0;
  const side = Math.min(box.width, box.height);

  return (
    <View style={[styles.fill, style]} onLayout={onLayout} pointerEvents="none">
      {ready && mode === "mercury" && <Mercury width={box.width} height={box.height} time={time} level={shown} />}
      {ready && mode === "ring" && (
        <View style={styles.center}>
          <Ring size={side} time={time} level={shown} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
