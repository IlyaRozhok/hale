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

  // The chip's handler comes and goes with the data (a background refetch brought or lost the limit's parts): the
  // figure then moves into or out of its button, and its count must go on from where it was.
  describe.each([
    ["appears", undefined, noop],
    ["disappears", noop, undefined],
  ])("when «Как посчитано» %s while the entrance key is live", (_name, first, then) => {
    const card = (onOpenParts: (() => void) | undefined) => <LimitCard state={todayFixture().state} streak={0} onOpenCalendar={noop} onOpenParts={onOpenParts} entrance={1} />;
    const shown = () => Number(screen.getByTestId("limit-count", HIDDEN).props.children[1]);

    it("a count on its way goes on and does not start again from zero", async () => {
      const { rerender } = await render(card(first));
      await passTime(300);
      await passTime(300);
      const before = shown();
      expect(before).toBeGreaterThan(600);
      await rerender(card(then));
      expect(screen.queryByTestId("limit-figure") !== null).toBe(then !== undefined);
      expect(shown()).toBe(before);
      await passTime(200);
      expect(shown()).toBeGreaterThanOrEqual(before);
      await passTime(200);
      expect(screen.queryByTestId("limit-count", HIDDEN)).toBeNull();
    });

    it("a finished count is not played again", async () => {
      const { rerender } = await render(card(first));
      await passTime(500);
      await passTime(500);
      expect(screen.queryByTestId("limit-count", HIDDEN)).toBeNull();
      await rerender(card(then));
      expect(screen.queryByTestId("limit-count", HIDDEN)).toBeNull();
      await passTime(100);
      expect(screen.queryByTestId("limit-count", HIDDEN)).toBeNull();
      expect(screen.getByText("₴720")).toBeTruthy();
    });
  });
});
