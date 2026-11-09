import { useEffect, useRef } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { useReduceMotion } from "../metal/useMetalActive";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

const TABS: Record<string, { icon: IconName; label: string }> = {
  Today: { icon: "home", label: "Сегодня" },
  Activity: { icon: "list", label: "Операции" },
  Plan: { icon: "target", label: "План" },
};

/** Short and calm: the open tab slides wider, no bounce. */
const OPEN_MS = 200;

/**
 * The bottom menu: a pill of icons in glass, floating over the content. The current tab opens up
 * into a light plate with its name; the others stay icons. The screens leave LAYOUT.tabBar for it.
 */
export function TabBar({ state, navigation }: Pick<BottomTabBarProps, "state" | "navigation">) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const last = useRef(state.index);
  useEffect(() => {
    if (last.current === state.index) return;
    last.current = state.index;
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(OPEN_MS, "easeInEaseOut", "opacity"));
  }, [state.index, reduced]);
  return (
    <View testID="tab-bar" pointerEvents="box-none" style={[styles.root, { paddingBottom: insets.bottom + space.xs }]}>
      <Glass kind="menu" style={styles.pill}>
        {state.routes.map((route, i) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === i;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              style={[styles.tab, focused && styles.active]}
            >
              <Icon name={tab.icon} color={focused ? color.accent.fgOnAccent : color.fg.default} />
              {focused && (
                <Text style={styles.label} numberOfLines={1}>
                  {tab.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.sm },
  pill: { flexDirection: "row", gap: space.xs, padding: space.xs, borderRadius: radius.full },
  tab: { flex: 1, flexDirection: "row", gap: space.xs, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  active: { flex: 2, backgroundColor: color.accent.default },
  label: { ...type.label, color: color.accent.fgOnAccent },
});
