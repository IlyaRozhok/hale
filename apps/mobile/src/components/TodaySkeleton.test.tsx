import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { TodaySkeleton } from "./TodaySkeleton";
import { LAYOUT } from "./layout";

const { color, space, touchMin, type } = tokens;

/*
 * The numbers of the loaded «Сегодня», copied here on purpose (task ЧЛ3а): the sections keep them as closed constants,
 * so the skeleton and this test repeat them. If one changes at its source, change it here and in `TodaySkeleton.tsx`.
 */
/** `SECTION_GAP` in `components/today/LimitCard.tsx` and in `components/today/SectionHead.tsx`. */
const SECTION_GAP = 26;
/** `FIGURE_TO_BAR`, `BAR_TO_LINE` and `BAR_GLOW` in `components/today/LimitCard.tsx`. */
const FIGURE_TO_BAR = 14;
const BAR_TO_LINE = 10;
const BAR_GLOW = 6;
/** `STRIP` and `HEIGHT` (the canvas) in `metal/LimitBar.tsx`. */
const STRIP = 4;
const BAR_CANVAS = STRIP + BAR_GLOW * 2;
/** `LINE_AIR` in `components/today/LimitCard.tsx`. */
const LINE_AIR = (touchMin - type.caption.lineHeight) / 2;
/** `HEIGHT` in `components/Runway.tsx`. */
const RUNWAY_HEIGHT = 112;

type Style = Record<string, unknown>;
type Node = { props: { style?: unknown; testID?: string }; children: (Node | string)[] | null };

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as Style;
const num = (v: unknown) => (typeof v === "number" ? v : 0);
/** What a block adds to its column: the margin above it and its own height. */
const takes = (id: string) => num(flat(id).marginTop) + num(flat(id).height);
const everyNode = (node: Node): Node[] => [node, ...(node.children ?? []).flatMap((c) => (typeof c === "string" ? [] : everyNode(c)))];

describe("the loading skeleton of Today", () => {
  it("keeps the label and the testID the screen and VoiceOver rely on", async () => {
    await render(<TodaySkeleton />);
    expect(screen.getByTestId("today-skeleton").props.accessibilityLabel).toBe("Загрузка");
  });

  it("has no card: nothing in it is filled but the loading bars, and nothing is padded or rounded like a card", async () => {
    await render(<TodaySkeleton />);
    const nodes = everyNode(screen.toJSON() as unknown as Node);
    for (const node of nodes) {
      const style = (StyleSheet.flatten(node.props.style as never) ?? {}) as Style;
      if (style.backgroundColor !== undefined) expect(style.backgroundColor).toBe(color.skeleton);
      expect(style.borderRadius).not.toBe(tokens.radius.card);
    }
    const limit = flat("skeleton-limit");
    expect(limit.backgroundColor).toBeUndefined();
    expect(limit.paddingHorizontal ?? 0).toBe(0);
    expect(limit.borderRadius ?? 0).toBe(0);
  });

  it("the limit has a placeholder for the label, the figure, the strip and the line, in that order", async () => {
    await render(<TodaySkeleton />);
    const ids = everyNode(screen.toJSON() as unknown as Node)
      .map((n) => n.props.testID)
      .filter((id): id is string => typeof id === "string" && id.startsWith("skeleton-limit-"));
    expect(ids).toEqual(["skeleton-limit-label", "skeleton-limit-figure", "skeleton-limit-strip", "skeleton-limit-line"]);
  });

  it("each part of the limit stands where the loaded section has it", async () => {
    await render(<TodaySkeleton />);
    // The screen puts `space.md` between its rows (`styles.content` in `screens/Today.tsx`), and so does the skeleton.
    expect(flat("today-skeleton").gap).toBe(space.md);
    // `styles.section`: `SECTION_GAP` stands above the section, the screen's own gap included.
    expect(flat("skeleton-limit").marginTop).toBe(SECTION_GAP - space.md);
    // `styles.eyebrow`.
    expect(flat("skeleton-limit-label")).toMatchObject({ height: LAYOUT.eyebrow + 4 });
    // `styles.amount`: `space.xs` under the label, one line of `type.hero`.
    expect(flat("skeleton-limit-figure")).toMatchObject({ marginTop: space.xs, height: type.hero.lineHeight });
    // The strip itself, without its glow: `FIGURE_TO_BAR` under the figure, inset by the glow at both ends.
    expect(flat("skeleton-limit-strip")).toMatchObject({ marginTop: FIGURE_TO_BAR, height: STRIP, marginHorizontal: BAR_GLOW });
    // The line's text: `BAR_TO_LINE` under the strip, one line of `type.caption`.
    expect(flat("skeleton-limit-line")).toMatchObject({ marginTop: BAR_TO_LINE, height: type.caption.lineHeight });
    // Under the text the loaded button still has its air (`LINE_AIR`); with it the next row starts at the same place.
    expect(flat("skeleton-limit").paddingBottom).toBe(LINE_AIR);
  });

  it("the limit is as tall as the loaded section with a limit", async () => {
    await render(<TodaySkeleton />);
    // `LimitCard.tsx` with a limit: the label, the figure, `styles.bar` (its padding and the strip's canvas), then
    // `styles.lineRow` (its negative margin and the `touchMin` button). The section's bottom margin is zero then.
    const loaded =
      LAYOUT.eyebrow + 4 +
      space.xs + type.hero.lineHeight +
      (FIGURE_TO_BAR - BAR_GLOW) + BAR_CANVAS +
      (BAR_TO_LINE - BAR_GLOW - LINE_AIR) + touchMin +
      Math.max(0, SECTION_GAP - space.md - LINE_AIR);
    expect(loaded).toBe(150);
    const skeleton =
      takes("skeleton-limit-label") + takes("skeleton-limit-figure") + takes("skeleton-limit-strip") + takes("skeleton-limit-line") + num(flat("skeleton-limit").paddingBottom);
    expect(skeleton).toBe(loaded);
  });

  it("the phrase is one row as tall as the loaded one", async () => {
    await render(<TodaySkeleton />);
    // `styles.phraseRow` in `components/today/DayPhraseRow.tsx`.
    expect(flat("skeleton-phrase")).toMatchObject({ minHeight: touchMin, paddingHorizontal: space.xs });
  });

  it("«До дохода» is a section without a card, as tall as the loaded one on a calm day", async () => {
    await render(<TodaySkeleton />);
    // `SECTION_MARGIN` in `components/today/SectionHead.tsx`.
    expect(flat("skeleton-until-income").marginTop).toBe(SECTION_GAP - space.md);
    expect(flat("skeleton-until-income").backgroundColor).toBeUndefined();
    // `UntilIncomeCard.tsx`, `styles.untilTop` (gap `space.xs`): the header (`SectionHead`, `type.label`), «К доходу
    // останется» (`type.title`), «если держаться лимита» (`type.body`).
    expect(flat("skeleton-until-head")).toMatchObject({ height: type.label.lineHeight });
    expect(flat("skeleton-until-figure")).toMatchObject({ marginTop: space.xs, height: type.title.lineHeight });
    expect(flat("skeleton-until-under")).toMatchObject({ marginTop: space.xs, height: type.body.lineHeight });
    // `styles.section` (gap `space.md`), then `Runway.tsx`: the chart (`HEIGHT`), `styles.root` (gap `space.sm`), the axis (`type.caption`).
    expect(flat("skeleton-until-chart")).toMatchObject({ marginTop: space.md, height: RUNWAY_HEIGHT });
    expect(flat("skeleton-until-axis")).toMatchObject({ marginTop: space.sm, height: type.caption.lineHeight });
    const loaded =
      type.label.lineHeight + space.xs + type.title.lineHeight + space.xs + type.body.lineHeight +
      space.md +
      RUNWAY_HEIGHT + space.sm + type.caption.lineHeight;
    expect(loaded).toBe(228);
    const skeleton = ["head", "figure", "under", "chart", "axis"].reduce((sum, part) => sum + takes(`skeleton-until-${part}`), 0);
    expect(skeleton).toBe(loaded);
  });

  it("the shared heights keep only what the loaded screen uses too", () => {
    // `amount`, `note` and `runway` served only the old skeleton (148 was the runway inside its card).
    expect(Object.keys(LAYOUT).sort()).toEqual(["eyebrow", "tabBar"]);
  });
});
