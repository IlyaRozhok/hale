import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { tokens } from "@hale/tokens";

const { color, radius, space } = tokens;

type Props = ViewProps & { children: ReactNode; /** "floating": the menu and windows, over content; "surface": cards. */ kind?: "surface" | "floating" };

/** A panel of the system's Liquid Glass over the backdrop; an opaque fill where the system has none. */
export function Glass({ children, style, kind = "surface", ...rest }: Props) {
  const surface = kind === "surface";
  const look = surface ? styles.surface : null;
  if (!isLiquidGlassAvailable()) {
    return (
      <View {...rest} style={[look, surface ? styles.surfaceFallback : styles.floatingFallback, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassView {...rest} glassEffectStyle="regular" tintColor={surface ? color.glass.surface.tint : color.glass.floating.tint} style={[look, style]}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: radius.xl, paddingHorizontal: space.lg, paddingVertical: space.md },
  surfaceFallback: { backgroundColor: color.glass.surface.fallback },
  floatingFallback: { backgroundColor: color.glass.floating.fallback },
});
