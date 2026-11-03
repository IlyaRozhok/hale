import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { tokens } from "@hale/tokens";

const { color, radius, space } = tokens;

type Props = ViewProps & { children: ReactNode; /** "floating": something passes behind it, so it is real glass. */ kind?: "surface" | "floating" };

/**
 * A panel. Cards sit on a plain background with nothing to blur, so they are a fill with a thin edge;
 * what floats over content is the system's Liquid Glass, or an opaque fill where the system has none.
 */
export function Glass({ children, style, kind = "surface", ...rest }: Props) {
  if (kind === "surface") {
    return (
      <View {...rest} style={[styles.surface, style]}>
        {children}
      </View>
    );
  }
  if (!isLiquidGlassAvailable()) {
    return (
      <View {...rest} style={[styles.fallback, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassView {...rest} glassEffectStyle="regular" tintColor={color.glass.floating.tint} style={style}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: color.glass.surface.fill,
    borderColor: color.glass.surface.edge,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  fallback: { backgroundColor: color.glass.floating.fallback },
});
