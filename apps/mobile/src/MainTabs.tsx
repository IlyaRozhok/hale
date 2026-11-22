import { useState } from "react";
import { StyleSheet } from "react-native";
import { DarkTheme, NavigationContainer, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import { createNativeBottomTabNavigator } from "@bottom-tabs/react-navigation";
import { tokens } from "@hale/tokens";
import { Activity } from "./screens/Activity";
import { Insights } from "./screens/Insights";
import { Plan } from "./screens/Plan";
import { Today } from "./screens/Today";
import { AddSheet } from "./components/AddSheet";

const { color } = tokens;

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "transparent", card: color.surface.inset, text: color.fg.default, primary: color.fg.default, border: color.surface.inset },
};

const Tabs = createNativeBottomTabNavigator();

function TodayTab({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  // `at` changes with every arrival, so the same day opened twice in a row is applied twice.
  return (
    <Today
      onOpenActivity={(day) => navigation.navigate("Activity", day ? { day, at: Date.now() } : undefined)}
      // The observation's category over its days, and that it came from the observation (В7).
      onOpenObservation={(category, from, to) => navigation.navigate("Activity", { category, from, to, observation: true, at: Date.now() })}
    />
  );
}

function InsightsTab({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  // A category's spending over the shown days of its month, as the filters of «Операции» put it.
  // «Желаемое» (В6): the purchases of «желаемое» over the same days.
  return (
    <Insights
      onOpenCategory={(category, from, to) => navigation.navigate("Activity", { category, from, to, at: Date.now() })}
      onOpenWanted={(from, to) => navigation.navigate("Activity", { want: true, from, to, at: Date.now() })}
    />
  );
}

/** «Добавить» is a button in the bar, never shown as a screen. */
const Nothing = () => null;

/**
 * The bottom menu is the system one (UITabBarController): on iOS 26 a glass capsule of four tabs with names,
 * and «+» beside it as a separate glass circle (the tab of the search role). «+» does not switch tabs:
 * it opens «Добавить» over the current screen (Д5). The screens leave LAYOUT.tabBar under their content for it.
 */
export function MainTabs() {
  const [adding, setAdding] = useState(false);
  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator tabBarActiveTintColor={color.fg.default} screenOptions={{ sceneStyle: styles.scene }}>
        <Tabs.Screen
          name="Today"
          component={TodayTab}
          options={{ title: "Сегодня", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "house.fill" : "house" }) }}
        />
        <Tabs.Screen name="Activity" component={Activity} options={{ title: "Операции", tabBarIcon: () => ({ sfSymbol: "list.bullet" }) }} />
        <Tabs.Screen name="Plan" component={Plan} options={{ title: "План", tabBarIcon: () => ({ sfSymbol: "target" }) }} />
        <Tabs.Screen
          name="Insights"
          component={InsightsTab}
          options={{ title: "Итоги", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "chart.bar.fill" : "chart.bar" }) }}
        />
        <Tabs.Screen
          name="Add"
          component={Nothing}
          options={{ title: "Добавить", role: "search", preventsDefault: true, tabBarIcon: () => ({ sfSymbol: "plus" }) }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setAdding(true);
            },
          }}
        />
      </Tabs.Navigator>
      {adding && <AddSheet onClose={() => setAdding(false)} />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: "transparent" },
});
