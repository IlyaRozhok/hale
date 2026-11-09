import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Canvas, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";

const { color } = tokens;

/**
 * Behind everything: the graphite base with a soft light at the top that fades out by the middle of
 * the screen. Still: drawn once, costs nothing after.
 */
export function Background() {
  const { width, height } = useWindowDimensions();
  return (
    <View testID="background" style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width / 2, 0)}
            r={Math.max(width, height * 0.6)}
            colors={[color.backdrop.glow, color.backdrop.mid, color.surface.base]}
            positions={[0, 0.45, 0.8]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}
