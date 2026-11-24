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
      // «Ещё N» under the payments (ЧЛ6): the tab opens as it was left, with no scroll to its «До дохода».
      onOpenPlan={() => navigation.navigate("Plan")}
    />
  );
}

function InsightsTab({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  // A category's spending over the shown days of its month, as the filters of «Операции» put it.
  // «Желаемое» (В6): the purchases of «желаемое» over the same days. «Платежи вне лимита» (Я8): those payments over
  // the same days; a subscription (Я8): every operation of its place, named as «Итоги» name it.
  return (
    <Insights
      onOpenCategory={(category, from, to) => navigation.navigate("Activity", { category, from, to, at: Date.now() })}
      onOpenWanted={(from, to) => navigation.navigate("Activity", { want: true, from, to, at: Date.now() })}
      onOpenOther={(from, to) => navigation.navigate("Activity", { other: true, from, to, at: Date.now() })}
      onOpenPlace={(place, placeName) => navigation.navigate("Activity", { place, placeName, at: Date.now() })}
    />
  );
}

/** «Добавить» is a button in the bar, never shown as a screen. */
const Nothing = () => null;

/**
 * The bottom menu is the system one (UITabBarController): on iOS 26 a glass capsule of four tabs, icons only,
 * and «+» beside it as a separate glass circle (the tab of the search role). «+» does not switch tabs:
 * it opens «Добавить» over the current screen (Д5). The screens leave LAYOUT.tabBar under their content for it.
 *
 * The names stay as the tabs' accessibility labels, for VoiceOver.
 *
 * A tab switches at once, with no animation. iOS 26 cross-fades the tabs, slowly, and our screens are transparent
 * over one shared background, so both showed through each other for the whole fade. `disablePageAnimations`
 * alone comes too late for that fade; patches/react-native-bottom-tabs@1.5.0.patch makes it work natively.
 * The tabs are mounted at launch (`lazy: false`): otherwise the first visit to a tab showed an empty screen for
 * a moment while it mounted.
 */
export function MainTabs() {
  const [adding, setAdding] = useState(false);
  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator
        tabBarActiveTintColor={color.fg.default}
        labeled={false}
        disablePageAnimations
        screenOptions={{ sceneStyle: styles.scene, lazy: false }}
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
});
