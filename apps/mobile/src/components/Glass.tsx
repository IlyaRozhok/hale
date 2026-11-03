import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { tokens } from "@hale/tokens";

const { color, radius, space } = tokens;

type Props = ViewProps & { children: ReactNode; /** "surface": cards; "floating": windows; "menu": the bottom menu. */ kind?: "surface" | "floating" | "menu" };

/** A panel of the system's Liquid Glass over the backdrop; an opaque fill where the system has none. */
export function Glass({ children, style, kind = "surface", ...rest }: Props) {
  const look = kind === "surface" ? styles.surface : null;
  if (!isLiquidGlassAvailable()) {
    return (
      <View {...rest} style={[look, { backgroundColor: color.glass[kind].fallback }, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassView {...rest} glassEffectStyle="regular" tintColor={color.glass[kind].tint} style={[look, style]}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: radius.xl, paddingHorizontal: space.lg, paddingVertical: space.md },
});
