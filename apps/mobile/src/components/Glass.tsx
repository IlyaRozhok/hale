import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { tokens } from "@hale/tokens";

const { color, radius, space } = tokens;

type Props = ViewProps & {
  children: ReactNode;
  /** "surface": solid cards; "card": the one glass card, over the backdrop's light; "floating": windows; "menu": the bottom menu. */
  kind?: "surface" | "card" | "floating" | "menu";
};

const TINT = { card: "surface", floating: "floating", menu: "menu" } as const;

/**
 * A panel. Cards are solid, one step above the screen and with no line around them: on the flat
 * graphite there is nothing for glass to blur. Windows and the menu float over content, so they are
 * the system's Liquid Glass (an opaque fill where the system has none). One card may be glass too:
 * the limit on Today; without the system's glass it is the ordinary solid card.
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
      <View {...rest} style={[kind === "card" ? styles.surface : { backgroundColor: color.glass[kind].fallback }, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassView {...rest} glassEffectStyle="regular" tintColor={color.glass[TINT[kind]].tint} style={style}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.card.fill,
  },
});
