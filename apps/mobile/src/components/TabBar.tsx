import { Pressable, StyleSheet, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin } = tokens;

const TABS: Record<string, { icon: IconName; label: string }> = {
  Today: { icon: "home", label: "Сегодня" },
  Activity: { icon: "list", label: "Операции" },
  Plan: { icon: "target", label: "План" },
};

/** The bottom menu: a pill of icons in glass, floating over the content. The screens leave LAYOUT.tabBar for it. The names are for assistive tech only. */
export function TabBar({ state, navigation }: Pick<BottomTabBarProps, "state" | "navigation">) {
  const insets = useSafeAreaInsets();
  return (
    <View testID="tab-bar" pointerEvents="box-none" style={[styles.root, { paddingBottom: insets.bottom + space.xs }]}>
      <Glass kind="floating" style={styles.pill}>
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
              <Icon name={tab.icon} color={focused ? color.accent.fgOnAccent : color.fg.subtle} />
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
  tab: { flex: 1, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  active: { backgroundColor: color.accent.default },
});
