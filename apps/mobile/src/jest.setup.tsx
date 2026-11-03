// Skia is native: icons render as plain views in tests.
jest.mock("./components/Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});
