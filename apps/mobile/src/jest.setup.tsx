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
