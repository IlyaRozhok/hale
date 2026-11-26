import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { BlurMask, Canvas, Circle, Group, LinearGradient, RoundedRect, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { tokens } from "@hale/tokens";
import type { LimitState } from "../limitState";
import { useMetalClock } from "./useMetalClock";
import { useAppActive, useReduceMotion } from "./useMetalActive";
import { growLevel } from "./level";

const { color } = tokens;
/** The strip is thin; the canvas is taller so the spark's glow is not clipped. */
const STRIP = 4;
const SPARK = 3;
const GLOW = 6;
const HEIGHT = STRIP + GLOW * 2;
/** One slow breath of the spark's glow, in seconds. */
const BREATH = 3.5;

const SPARK_COLOR: Record<LimitState, string> = { ok: color.limit.ok, low: color.limit.low, over: color.limit.over };

type Props = {
  /** Share of the daily limit left, 0..1. */
  level: number;
  state: LimitState;
  /** The screen's entrance key (task ЧЛ8): with a new one above zero the strip grows to its length once. */
  entrance?: number;
};

/**
 * The limit as a thin silver strip over a dark track, shorter as the day is spent, with a small
 * spark at its end: green while plenty is left, sand when little. Once nothing is left the strip
 * fills and deepens to red, with a red spark (owner's choice). Only the spark glows, and it
 * breathes slowly; still in the background and under reduce-motion.
 *
 * With an entrance key the strip grows from nothing to its length over a second, the spark at its end, and then
 * stands. A day over the limit does not grow its red strip: it is there at once.
 */
export function LimitBar({ level, state, entrance = 0 }: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReduceMotion();
  const active = useAppActive();
  const { time, shown, grown } = useMetalClock(state === "over" ? 1 : level, active && !reduced, reduced, state === "over" ? 0 : entrance);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  return (
    <View style={styles.box} onLayout={onLayout} pointerEvents="none">
      {width > 0 && (
        <Canvas style={{ width, height: HEIGHT }}>
          <Strip width={width} state={state} time={time} level={shown} grown={grown} />
        </Canvas>
      )}
    </View>
  );
}

function Strip({ width, state, time, level, grown }: { width: number; state: LimitState; time: SharedValue<number>; level: SharedValue<number>; grown: SharedValue<number> }) {
  const y = GLOW;
  const inner = width - GLOW * 2;
  const filled = useDerivedValue(() => Math.max(STRIP, inner * level.value * growLevel(grown.value)));
  const tipX = useDerivedValue(() => GLOW + filled.value - SPARK);
  const glow = useDerivedValue(() => 0.45 + 0.25 * Math.sin((time.value * 2 * Math.PI) / BREATH));
  const spark = SPARK_COLOR[state];
  return (
    <Group>
      <RoundedRect x={GLOW} y={y} width={inner} height={STRIP} r={STRIP / 2} color={color.data.track} />
      <RoundedRect x={GLOW} y={y} width={filled} height={STRIP} r={STRIP / 2}>
        <LinearGradient
          start={vec(GLOW, 0)}
          end={vec(GLOW + inner, 0)}
          colors={state === "over" ? [color.limit.overDeep, color.limit.over] : [color.limit.strip, color.limit.strip]}
        />
      </RoundedRect>
      <Group opacity={glow}>
        <Circle cx={tipX} cy={y + STRIP / 2} r={SPARK + 3} color={spark}>
          <BlurMask blur={GLOW} style="normal" />
        </Circle>
      </Group>
      <Circle cx={tipX} cy={y + STRIP / 2} r={SPARK} color={spark} />
    </Group>
  );
}

const styles = StyleSheet.create({ box: { height: HEIGHT, marginHorizontal: -GLOW } });
