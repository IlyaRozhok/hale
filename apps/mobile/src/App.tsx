import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DarkTheme, NavigationContainer, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { tokens } from "@hale/tokens";
import { API_URL } from "./config";
import { createApi } from "./api/client";
import { ApiProvider } from "./api/context";
import { createStorePersister, shouldPersist } from "./api/persist";
import { CACHE_KEY, TOKEN_KEY, keychain } from "./api/secureStore";
import { Login } from "./screens/Login";
import { Activity } from "./screens/Activity";
import { Insights } from "./screens/Insights";
import { Plan } from "./screens/Plan";
import { TabBar } from "./components/TabBar";
import { Background } from "./components/Background";
import { createPushDeps } from "./pushNative";
import { registerPush } from "./push";
import { useApi } from "./api/context";
import { Today } from "./screens/Today";
import { SessionProvider } from "./session";

const { color } = tokens;
const DAY = 24 * 60 * 60 * 1000;
const DEVICE_NAME = "iPhone";

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "transparent", card: color.surface.inset, text: color.fg.default, primary: color.fg.default, border: color.surface.inset },
};

const Tabs = createBottomTabNavigator();

function TodayTab({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  // `at` changes with every arrival, so the same day opened twice in a row is applied twice.
  return <Today onOpenActivity={(day) => navigation.navigate("Activity", day ? { day, at: Date.now() } : undefined)} />;
}

function InsightsTab({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  // A category's spending over the shown days of its month, as the filters of «Операции» put it.
  return <Insights onOpenCategory={(category, from, to) => navigation.navigate("Activity", { category, from, to, at: Date.now() })} />;
}

function Main() {
  const api = useApi();
  // Ask for notifications once after login. A refusal or a missing token changes nothing.
  useEffect(() => {
    void registerPush(createPushDeps(api, keychain));
  }, [api]);

  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: styles.scene }}>
        <Tabs.Screen name="Today" component={TodayTab} options={{ title: "Сегодня" }} />
        <Tabs.Screen name="Activity" component={Activity} options={{ title: "Операции" }} />
        <Tabs.Screen name="Plan" component={Plan} options={{ title: "План" }} />
        <Tabs.Screen name="Insights" component={InsightsTab} options={{ title: "Итоги" }} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // undefined: still reading the Keychain; null: signed out.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { gcTime: 7 * DAY, retry: 1 } } }),
    [],
  );
  const persister = useMemo(() => createStorePersister(keychain, CACHE_KEY), []);

  const signOut = useCallback(async () => {
    setToken(null);
    client.clear();
    await Promise.allSettled([keychain.remove(TOKEN_KEY), persister.removeClient()]);
  }, [client, persister]);

  const api = useMemo(
    () => createApi({ baseUrl: API_URL, getToken: () => keychain.get(TOKEN_KEY), onUnauthorized: () => void signOut() }),
    [signOut],
  );

  useEffect(() => {
    keychain.get(TOKEN_KEY).then(
      (t) => setToken(t),
      () => setToken(null),
    );
  }, []);

  // Refresh when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
    return () => sub.remove();
  }, []);

  const leave = useCallback(() => void signOut(), [signOut]);

  const signedIn = async (t: string) => {
    await keychain.set(TOKEN_KEY, t);
    setToken(t);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.backdrop}>
        <Background />
      </View>
      <PersistQueryClientProvider
        client={client}
        persistOptions={{ persister, maxAge: 7 * DAY, dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}
      >
        <ApiProvider api={api}>
          {token === undefined ? <View style={styles.blank} /> : token === null ? <Login deviceName={DEVICE_NAME} onSignedIn={signedIn} /> : (
            <SessionProvider signOut={leave}>
              <Main />
            </SessionProvider>
          )}
        </ApiProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1 },
  scene: { backgroundColor: "transparent" },
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: color.surface.base },
});
