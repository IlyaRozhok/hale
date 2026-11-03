// Skia is native: icons render as plain views in tests.
jest.mock("./components/Icon", () => {
  const { View } = jest.requireActual("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

// A canvas of Skia, which needs the native module; the positions it draws at are tested in calendarLayout.
jest.mock("./metal/MetalEdges", () => ({ MetalEdges: () => null }));
