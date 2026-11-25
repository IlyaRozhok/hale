import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { LAYOUT } from "./layout";

const { color, radius, space, touchMin, type } = tokens;

/*
 * The loaded sections keep their sizes as closed constants, so the numbers are repeated here (task ЧЛ3а). Each names
 * its source: when one changes there, change it here and in `TodaySkeleton.test.tsx`.
 */
/** `SECTION_GAP` in `components/today/LimitCard.tsx` and `components/today/SectionHead.tsx`: one section to the next. */
const SECTION_GAP = 26;
/** `FIGURE_TO_BAR` in `components/today/LimitCard.tsx`: the figure to the strip. */
const FIGURE_TO_BAR = 14;
/** `BAR_TO_LINE` in `components/today/LimitCard.tsx`: the strip to the text of the line. */
const BAR_TO_LINE = 10;
/** `BAR_GLOW` in `components/today/LimitCard.tsx` (`GLOW` in `metal/LimitBar.tsx`): the strip is drawn this far in from both ends. */
const BAR_GLOW = 6;
/** `STRIP` in `metal/LimitBar.tsx`: how thick the strip is. */
const STRIP = 4;
/** `LINE_AIR` in `components/today/LimitCard.tsx`: the air of the line's `touchMin` button above and below its text. */
const LINE_AIR = (touchMin - type.caption.lineHeight) / 2;
/** `HEIGHT` in `components/Runway.tsx`: the chart. */
const RUNWAY_HEIGHT = 112;

/**
 * Today while it loads for the first time. Same geometry as the loaded screen, so nothing jumps when data arrives:
 * the date, the limit (label, figure, strip, line), the phrase, «До дохода» (header, two lines, chart, axis).
 *
 * Contract: no card and no fill but the bars themselves — the loaded sections stand on the screen with none. Each
 * block is a box as tall as the text line it stands for, with a lower bar in the middle of it. «До дохода» is sized
 * for a calm day with something left (the tallest plain top); «Платежи» and what follows have no placeholder, as
 * they may be absent. `testID="today-skeleton"` and the «Загрузка» label are what the screen's tests and VoiceOver use.
 */
export function TodaySkeleton() {
  return (
    <View testID="today-skeleton" style={styles.root} accessibilityLabel="Загрузка">
      <View style={styles.date}>
        <Bar width={160} height={14} />
      </View>
      <View testID="skeleton-limit" style={styles.limit}>
        <View testID="skeleton-limit-label" style={styles.limitLabel}>
          <Bar width={120} height={14} />
        </View>
        <View testID="skeleton-limit-figure" style={styles.limitFigure}>
          <Bar width={200} height={44} />
        </View>
        <View testID="skeleton-limit-strip" style={[styles.bar, styles.limitStrip]} />
        <View testID="skeleton-limit-line" style={styles.limitLine}>
          <Bar width={170} height={10} />
        </View>
      </View>
      <View testID="skeleton-phrase" style={styles.phrase}>
        <Bar width={240} height={14} />
      </View>
      <View testID="skeleton-until-income" style={styles.until}>
        <View testID="skeleton-until-head" style={styles.untilHead}>
          <Bar width={90} height={12} />
          <Bar width={48} height={12} />
        </View>
        <View testID="skeleton-until-figure" style={styles.untilFigure}>
          <Bar width={210} height={16} />
        </View>
        <View testID="skeleton-until-under" style={styles.untilUnder}>
          <Bar width={250} height={14} />
        </View>
        <View testID="skeleton-until-chart" style={[styles.bar, styles.untilChart]} />
        <View testID="skeleton-until-axis" style={styles.untilAxis}>
          <Bar width={52} height={10} />
          <Bar width={84} height={10} />
        </View>
      </View>
    </View>
  );
}

function Bar({ width, height }: { width: number; height: number }) {
  return <View testID="skeleton-bar" style={[styles.bar, { width, height }]} />;
}

const styles = StyleSheet.create({
  // `styles.content` in `screens/Today.tsx`: the screen puts `space.md` between its rows.
  root: { gap: space.md },
  // `TodayHeader`: the row is as tall as its `touchMin` profile button.
  date: { minHeight: touchMin, justifyContent: "center" },
  bar: { backgroundColor: color.skeleton, borderRadius: radius.md },
  // `styles.section` in `LimitCard.tsx`. Under the line's text is the lower air of its button; with a limit the
  // loaded section has no bottom margin beyond it.
  limit: { marginTop: SECTION_GAP - space.md, paddingBottom: LINE_AIR },
  // `styles.eyebrow` in `LimitCard.tsx`.
  limitLabel: { height: LAYOUT.eyebrow + 4, justifyContent: "center" },
  // `styles.amount` in `LimitCard.tsx`: one line of `type.hero`.
  limitFigure: { marginTop: space.xs, height: type.hero.lineHeight, justifyContent: "center" },
  limitStrip: { marginTop: FIGURE_TO_BAR, marginHorizontal: BAR_GLOW, height: STRIP, borderRadius: STRIP / 2 },
  // `styles.subtle` in `LimitCard.tsx`: one line of `type.caption`.
  limitLine: { marginTop: BAR_TO_LINE, height: type.caption.lineHeight, justifyContent: "center" },
  // `styles.phraseRow` in `components/today/DayPhraseRow.tsx`.
  phrase: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.xs },
  // `SECTION_MARGIN` in `components/today/SectionHead.tsx`, `styles.section` in `UntilIncomeCard.tsx`.
  until: { marginTop: SECTION_GAP - space.md },
  // `SectionHead`: the title at the left, the days at the right, `type.label`.
  untilHead: { height: type.label.lineHeight, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // `styles.untilTop` (gap `space.xs`), `styles.calmText` (`type.title`) and `styles.untilUnder` (`type.body`) in `UntilIncomeCard.tsx`.
  untilFigure: { marginTop: space.xs, height: type.title.lineHeight, justifyContent: "center" },
  untilUnder: { marginTop: space.xs, height: type.body.lineHeight, justifyContent: "center" },
  // `styles.section` in `UntilIncomeCard.tsx` (gap `space.md`), then the chart of `Runway.tsx`.
  untilChart: { marginTop: space.md, height: RUNWAY_HEIGHT },
  // `styles.root` (gap `space.sm`) and `styles.axis` (`type.caption`) in `Runway.tsx`.
  untilAxis: { marginTop: space.sm, height: type.caption.lineHeight, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
