import { StyleSheet, View, useWindowDimensions } from "react-native";
import { BlurMask, Canvas, Circle, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";

const { color } = tokens;

/**
 * Behind everything: the graphite base with a soft light at the top that fades out by the middle of
 * the screen, and two faint blooms where the glass sits, so that it has something to bend. Still:
 * drawn once, costs nothing after.
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
        <Circle cx={width * 0.82} cy={height * 0.2} r={width * 0.34} color={color.backdrop.sheet} opacity={0.3}>
          <BlurMask blur={width * 0.22} style="normal" />
        </Circle>
        <Circle cx={width * 0.1} cy={height * 0.36} r={width * 0.26} color={color.backdrop.sheet} opacity={0.16}>
          <BlurMask blur={width * 0.2} style="normal" />
        </Circle>
      </Canvas>
    </View>
  );
}
