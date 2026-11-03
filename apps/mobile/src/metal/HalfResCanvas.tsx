import type { ReactNode } from "react";
import { View } from "react-native";
import { Canvas, Fill, Shader } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { tokens } from "@hale/tokens";
import { metalEffect } from "./metal.sksl";

/** The metal is soft, so it renders at a quarter of the pixels (half width, half height). */
const SCALE = tokens.metal.renderScale;

type CanvasProps = {
  width: number;
  height: number;
  /** Called with the canvas's own (half) size in points. */
  children: (size: { width: number; height: number }) => ReactNode;
};

/**
 * Half-resolution rendering: the Skia canvas is width/2 by height/2 and the GPU compositor scales
 * it 2x about its centre, so the fragment shader runs on a quarter of the pixels.
 */
export function HalfResCanvas({ width, height, children }: CanvasProps) {
  const w = width / SCALE;
  const h = height / SCALE;
  return (
    <View style={{ width, height }} pointerEvents="none">
      <Canvas
        style={{
          position: "absolute",
          left: (width - w) / 2,
          top: (height - h) / 2,
          width: w,
          height: h,
          transform: [{ scale: SCALE }],
        }}
      >
        {children({ width: w, height: h })}
      </Canvas>
    </View>
  );
}

type FillProps = {
  width: number;
  height: number;
  time: SharedValue<number>;
  level: SharedValue<number>;
  pool: boolean;
};

/** The shared surface: fills the (half-res) canvas with the metal shader. */
export function MetalFill({ width, height, time, level, pool }: FillProps) {
  const uniforms = useDerivedValue(() => ({
    r: [width, height],
    t: time.value,
    level: level.value,
    pool: pool ? 1 : 0,
  }));
  return (
    <Fill>
      <Shader source={metalEffect} uniforms={uniforms} />
    </Fill>
  );
}
