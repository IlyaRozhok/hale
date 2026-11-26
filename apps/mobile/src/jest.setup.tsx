// «Сегодня» plays its entrance only with motion allowed (task ЧЛ8). In tests motion counts as reduced, as it does in
// the app until the setting is known: every screen is in its final state at once. A test of the entrance itself
// turns motion on with `allowMotion()` of testing.tsx.
jest.mock("./metal/useMetalActive", () => ({ ...jest.requireActual("./metal/useMetalActive"), useReduceMotion: jest.fn(() => true) }));

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
// on its first visit (or at once when it is not lazy) and stays mounted, hidden from accessibility, while another
// tab is current. Names are drawn
// only when the bar is labeled; whether pages animate is reported on the bar.
type MockTabRoute = { key: string };
type MockTabViewProps = {
  navigationState: { index: number; routes: MockTabRoute[] };
  renderScene: (p: { route: MockTabRoute; jumpTo: (key: string) => void }) => import("react").ReactNode;
  onIndexChange: (index: number) => void;
  getLabelText: (p: { route: MockTabRoute }) => string | undefined;
  getIcon: (p: { route: MockTabRoute; focused: boolean }) => { sfSymbol?: string } | null | undefined;
  getRole: (p: { route: MockTabRoute }) => string | undefined;
  getLazy: (p: { route: MockTabRoute }) => boolean | undefined;
  tabBarActiveTintColor?: string;
  labeled?: boolean;
  disablePageAnimations?: boolean;
};
jest.mock("react-native-bottom-tabs", () => {
  const { useState } = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const TabView = ({ navigationState, renderScene, onIndexChange, getLabelText, getIcon, getRole, getLazy, tabBarActiveTintColor, labeled = true, disablePageAnimations = false }: MockTabViewProps) => {
    const current = navigationState.routes[navigationState.index];
    const [visited, setVisited] = useState([] as string[]);
    if (current && !visited.includes(current.key)) setVisited([...visited, current.key]);
    const jumpTo = (key: string) => onIndexChange(navigationState.routes.findIndex((r) => r.key === key));
    return (
      <View style={{ flex: 1 }}>
        {navigationState.routes
          .filter((route) => route.key === current?.key || visited.includes(route.key) || getLazy({ route }) === false)
          .map((route) => {
            const focused = route.key === current?.key;
            return (
              <View key={route.key} style={{ flex: 1 }} accessibilityElementsHidden={!focused} importantForAccessibility={focused ? "auto" : "no-hide-descendants"}>
                {renderScene({ route, jumpTo })}
              </View>
            );
          })}
        <View testID="tab-bar" accessibilityHint={tabBarActiveTintColor} accessibilityValue={{ text: disablePageAnimations ? "no-page-animations" : "page-animations" }}>
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

// The segmented control is UIKit's (UISegmentedControl). In tests it is a row of buttons named by their labels, as
// VoiceOver reads the native segments. Like the native one it moves to a tapped segment by itself, reports only a
// change (a tap on the chosen segment sends nothing), and takes `selectedIndex` only when that prop changes.
type MockSegmentedProps = {
  values?: string[];
  selectedIndex?: number;
  enabled?: boolean;
  appearance?: string;
  tintColor?: string;
  testID?: string;
  style?: unknown;
  onChange?: (e: { nativeEvent: { value: string; selectedSegmentIndex: number } }) => void;
  onValueChange?: (value: string) => void;
};
jest.mock("@react-native-segmented-control/segmented-control", () => {
  const { useState } = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const SegmentedControl = ({ values = [], selectedIndex = -1, enabled = true, appearance, tintColor, testID, style, onChange, onValueChange }: MockSegmentedProps) => {
    const [shown, setShown] = useState(selectedIndex);
    const [prop, setProp] = useState(selectedIndex);
    if (prop !== selectedIndex) {
      setProp(selectedIndex);
      setShown(selectedIndex);
    }
    return (
      <View testID={testID} style={style} accessibilityHint={[appearance, tintColor].filter(Boolean).join(" ")}>
        {values.map((v, i) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={v}
            accessibilityState={{ selected: i === shown, disabled: !enabled }}
            disabled={!enabled}
            onPress={() => {
              if (i === shown) return;
              setShown(i);
              onChange?.({ nativeEvent: { value: v, selectedSegmentIndex: i } });
              onValueChange?.(v);
            }}
          >
            <Text>{v}</Text>
          </Pressable>
        ))}
      </View>
    );
  };
  return { __esModule: true, default: SegmentedControl };
});
