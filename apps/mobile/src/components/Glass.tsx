import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space } = tokens;

/** A panel on surface.overMetal (dark enough to read over the metal): fill and spacing, never a border. */
export function Glass({ children, style, ...rest }: ViewProps & { children: ReactNode }) {
  return (
    <View {...rest} style={[styles.glass, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { backgroundColor: color.surface.overMetal, borderRadius: radius.xl, paddingHorizontal: space.lg, paddingVertical: space.md },
});
