import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { AddSheet } from "./AddSheet";
import { Glass } from "./Glass";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin } = tokens;

const TABS: Record<string, { icon: IconName; label: string }> = {
  Today: { icon: "home", label: "Сегодня" },
  Activity: { icon: "list", label: "Операции" },
  Plan: { icon: "target", label: "План" },
  Insights: { icon: "chart", label: "Итоги" },
};

/** The pill and the round button beside it are the same height. */
const SIZE = touchMin + space.xs * 2;

/**
 * The bottom menu, floating in glass over the content: a pill of icons only, the current one white
 * and the others dim, and beside it a round button that adds an operation from any screen. The
 * screens leave LAYOUT.tabBar for it.
 */
export function TabBar({ state, navigation }: Pick<BottomTabBarProps, "state" | "navigation">) {
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(false);
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
              style={styles.tab}
            >
              <Icon name={tab.icon} color={focused ? color.fg.default : color.fg.subtle} />
            </Pressable>
          );
        })}
      </Glass>
      <Pressable accessibilityRole="button" accessibilityLabel="Добавить операцию" onPress={() => setAdding(true)} style={styles.addPress}>
        <Glass kind="menu" style={styles.add}>
          <Icon name="plus" color={color.fg.default} />
        </Glass>
      </Pressable>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm },
  pill: { flex: 1, flexDirection: "row", gap: space.xs, padding: space.xs, borderRadius: radius.full },
  tab: { flex: 1, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  addPress: { minHeight: touchMin },
  add: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
});
