import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader } from "@shopify/react-native-skia";
import { backdropEffect } from "./backdrop.sksl";

/** Behind everything, so the glass has something to bend. Still: it draws once and costs nothing after. */
export function Backdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={backdropEffect} uniforms={{ r: [width, height] }} />
        </Fill>
      </Canvas>
    </View>
  );
}
