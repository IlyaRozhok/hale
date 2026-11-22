// Skia is native: icons render as plain views in tests.
jest.mock("./components/Icon", () => {
  const { View } = jest.requireActual("react-native");
  return { Icon: ({ name, color }: { name: string; color: string }) => <View testID={`icon-${name}`} accessibilityHint={color} /> };
});

// The runway's line is a canvas of Skia; where it draws is tested in runwayChart.
jest.mock("./components/RunwayLine", () => {
  const { View } = jest.requireActual("react-native");
  return { RunwayLine: ({ selected }: { selected: number | null }) => <View testID="runway-line" accessibilityHint={`selected:${selected}`} /> };
});

// The tab bar is UIKit's (react-native-bottom-tabs). In tests it is a row of tabs that reports a press the way the
// native one does (onIndexChange, also for a tab that prevents selection). As in the library, a scene is mounted
// on its first visit and stays mounted, hidden from accessibility, while another tab is current. Names are drawn
// only when the bar is labeled.
type MockTabRoute = { key: string };
type MockTabViewProps = {
  navigationState: { index: number; routes: MockTabRoute[] };
  renderScene: (p: { route: MockTabRoute; jumpTo: (key: string) => void }) => import("react").ReactNode;
  onIndexChange: (index: number) => void;
  getLabelText: (p: { route: MockTabRoute }) => string | undefined;
  getIcon: (p: { route: MockTabRoute; focused: boolean }) => { sfSymbol?: string } | null | undefined;
  getRole: (p: { route: MockTabRoute }) => string | undefined;
  tabBarActiveTintColor?: string;
  labeled?: boolean;
};
jest.mock("react-native-bottom-tabs", () => {
  const { useState } = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const TabView = ({ navigationState, renderScene, onIndexChange, getLabelText, getIcon, getRole, tabBarActiveTintColor, labeled = true }: MockTabViewProps) => {
    const current = navigationState.routes[navigationState.index];
    const [visited, setVisited] = useState([] as string[]);
    if (current && !visited.includes(current.key)) setVisited([...visited, current.key]);
    const jumpTo = (key: string) => onIndexChange(navigationState.routes.findIndex((r) => r.key === key));
    return (
      <View style={{ flex: 1 }}>
        {navigationState.routes
          .filter((route) => route.key === current?.key || visited.includes(route.key))
          .map((route) => {
            const focused = route.key === current?.key;
            return (
              <View key={route.key} style={{ flex: 1 }} accessibilityElementsHidden={!focused} importantForAccessibility={focused ? "auto" : "no-hide-descendants"}>
                {renderScene({ route, jumpTo })}
              </View>
            );
          })}
        <View testID="tab-bar" accessibilityHint={tabBarActiveTintColor}>
          {navigationState.routes.map((route, i) => {
            const focused = i === navigationState.index;
            const label = getLabelText({ route }) ?? route.key;
            const symbol = getIcon({ route, focused })?.sfSymbol;
            return (
              <Pressable key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} onPress={() => onIndexChange(i)}>
                {symbol && <View testID={`tab-symbol-${symbol}`} />}
                <View testID={`tab-role-${route.key.split("-")[0]}`} accessibilityHint={getRole({ route }) ?? ""} />
                {labeled && <Text>{label}</Text>}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };
  return { __esModule: true, default: TabView };
});
