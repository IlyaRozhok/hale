import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { DarkTheme, NavigationContainer, useIsFocused, type NavigationProp, type ParamListBase } from "@react-navigation/native";
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
 * A tab that is left hides its screen at once. iOS 26 cross-fades the tabs natively, from the tap, and the
 * screens are transparent over one shared background, so the screen being left stayed visible through the new
 * one for the whole fade. Hidden, it leaves only the new screen coming in over the background.
 */
function Scene({ name, children }: { name: string; children: ReactNode }) {
  const focused = useIsFocused();
  return (
    <View testID={`tab-scene-${name}`} style={[styles.layout, !focused && styles.away]}>
      {children}
    </View>
  );
}

/**
 * The bottom menu is the system one (UITabBarController): on iOS 26 a glass capsule of four tabs, icons only,
 * and «+» beside it as a separate glass circle (the tab of the search role). «+» does not switch tabs:
 * it opens «Добавить» over the current screen (Д5). The screens leave LAYOUT.tabBar under their content for it.
 *
 * The names stay as the tabs' accessibility labels, for VoiceOver.
 */
export function MainTabs() {
  const [adding, setAdding] = useState(false);
  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator
        tabBarActiveTintColor={color.fg.default}
        labeled={false}
        screenOptions={{ sceneStyle: styles.scene }}
        screenLayout={({ route, children }) => <Scene name={route.name}>{children}</Scene>}
      >
        {/* SF Symbols in outline, filled while their tab is the current one. */}
        <Tabs.Screen
          name="Today"
          component={TodayTab}
          options={{ title: "Сегодня", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "house.fill" : "house" }) }}
        />
        <Tabs.Screen
          name="Activity"
          component={Activity}
          options={{ title: "Операции", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "list.bullet.rectangle.fill" : "list.bullet.rectangle" }) }}
        />
        <Tabs.Screen
          name="Plan"
          component={Plan}
          options={{ title: "План", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "wallet.bifold.fill" : "wallet.bifold" }) }}
        />
        <Tabs.Screen
          name="Insights"
          component={InsightsTab}
          options={{ title: "Итоги", tabBarIcon: ({ focused }) => ({ sfSymbol: focused ? "chart.pie.fill" : "chart.pie" }) }}
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
  layout: { flex: 1 },
  away: { opacity: 0 },
});
