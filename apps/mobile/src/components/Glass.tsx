import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { tokens } from "@tablo/tokens";

const { color, radius, space } = tokens;

/** A panel on surface.glass: separated by fill and spacing, never a border. */
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  glass: { backgroundColor: color.surface.glass, borderRadius: radius.xl, paddingHorizontal: space.lg, paddingVertical: space.md },
});
