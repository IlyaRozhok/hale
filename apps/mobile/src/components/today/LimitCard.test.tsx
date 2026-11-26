import { render, screen } from "@testing-library/react-native";
import { LimitBar } from "../../metal";
import { passTime, todayFixture } from "../../testing";
import { LimitCard } from "./LimitCard";

// The strip is drawn every time the section is: the mock counts how often that is.
jest.mock("../../metal", () => {
  const { View } = require("react-native");
  return { LimitBar: jest.fn(() => <View testID="limit-visual" />) };
});

const HIDDEN = { includeHiddenElements: true };
const noop = () => undefined;
const drawn = () => (LimitBar as unknown as jest.Mock).mock.calls.length;

describe("LimitCard, the counting figure (ЧЛ8а)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("while the figure counts only the figure is drawn again, not the section around it", async () => {
    await render(<LimitCard state={todayFixture().state} streak={0} onOpenCalendar={noop} onOpenParts={noop} entrance={1} />);
    const count = () => screen.getByTestId("limit-count", HIDDEN);
    expect(count()).toHaveTextContent("₴0");
    const before = drawn();
    expect(before).toBeGreaterThan(0);
    // The figure moves on with the frames...
    await passTime(300);
    expect(count()).toHaveTextContent(/^₴[1-9]\d{2}$/);
    await passTime(300);
    await passTime(400);
    expect(screen.queryByTestId("limit-count", HIDDEN)).toBeNull();
    expect(screen.getByText("₴720")).toBeTruthy();
    // ...and the section was not drawn once on the way.
    expect(drawn()).toBe(before);
  });
});
