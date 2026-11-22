import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color } = tokens;

/**
 * Behind everything: one flat dark graphite, with no light at the top (the owner's variant «Б», soft graphite).
 * Cards stand out from it by being one step lighter, not by a light behind them.
 */
export function Background() {
  return (
    <View
      testID="background"
      style={styles.fill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  fill: { ...(StyleSheet.absoluteFill as object), backgroundColor: color.surface.base },
});
