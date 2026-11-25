import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney } from "../../format";
import type { CategoryList } from "../../labels";
import { monthSection, type MonthSection as Month } from "../../monthSection";
import { Icon } from "../Icon";
import { SECTION_MARGIN, SectionHead } from "./SectionHead";

const { color, radius, space, touchMin, type } = tokens;

/** Whole phrases, so they can be translated as they are. */
const HINT = "Нажмите на категорию, чтобы увидеть, что изменилось.";
const SUM_LABEL = "Потрачено {sum}, {average}";

/**
 * The month on «Сегодня» (task ЧЛ7): the short version of «Итоги». Not a card: it stands on the screen itself under
 * its own header, like «До дохода» and «Платежи».
 *
 * Contract:
 * - `monthSection` decides everything that is shown and said: the sum, the average, the comparison, which categories
 *   are shares (none at or below zero, so no «Возвраты») and each share's phrase. While «Итоги» load, after a failed
 *   request, from an older server and in a month with nothing spent, nothing is drawn.
 * - The header is a button that calls `onOpenInsights` when it is given; otherwise a plain header.
 * - The shares of the bar are buttons named aloud. The names under the bar choose the same shares, for a finger; they
 *   are hidden from VoiceOver, which has the bar. A chosen share dims the others and its phrase replaces the hint
 *   under the bar; pressed again, the choice is gone.
 * - One accent, the sage in five steps. Sand is only the arrow at a category well above the month before; the pill
 *   is sage only when the month is below the one before. Nothing here is red.
 */
export function MonthSection({
  insights,
  categories,
  onOpenInsights,
}: {
  /** `GET /insights/month` for the current month: undefined while loading or after an error, null from an older server. */
  insights: InsightsMonthDto | null | undefined;
  categories: CategoryList;
  onOpenInsights?: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const month = monthSection(insights, categories);
  if (!month) return null;
  // A choice the data no longer has (the month refreshed) counts as none.
  const current = month.shares.find((s) => s.key === chosen) ?? null;
  const choose = (key: string) => setChosen(current?.key === key ? null : key);
  const dim = (key: string) => ({ opacity: current === null || current.key === key ? 1 : DIMMED });
  const headLabel = month.comparison ? `${month.title}. ${month.comparison.label}` : month.title;
  const head = <SectionHead title={month.title} side={month.comparison && <Pill comparison={month.comparison} />} chevron={onOpenInsights !== undefined} />;
  const sum = formatMoney(month.total);
  const last = month.shares.length - 1;

  return (
    <View testID="month-section" style={styles.section}>
      {onOpenInsights ? (
        <Pressable testID="month-head" accessibilityRole="button" accessibilityLabel={headLabel} accessibilityHint="Открывает итоги" onPress={onOpenInsights} style={styles.head}>
          {head}
        </Pressable>
      ) : (
        <View testID="month-head" accessible accessibilityRole="header" accessibilityLabel={headLabel} style={styles.head}>
          {head}
        </View>
      )}
      <View accessible accessibilityLabel={SUM_LABEL.replace("{sum}", sum).replace("{average}", month.average)} style={styles.sumRow}>
        {/* The figure with a quiet «₴» half its size, as the day's limit has it. */}
        <Text style={styles.sum}>
          <Text style={styles.sign}>₴</Text>
          {sum.slice(1)}
        </Text>
        <Text style={styles.average}>{month.average}</Text>
      </View>
      <View style={styles.bar}>
        {month.shares.map((s, i) => (
          <Pressable
            key={s.key}
            testID={`month-share-${s.key}`}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: current?.key === s.key }}
            onPress={() => choose(s.key)}
            // The strip is 12 pt; the button around it is 44 pt tall.
            style={[styles.share, { flexGrow: s.amount }, dim(s.key)]}
          >
            <View testID={`month-strip-${s.key}`} style={[styles.strip, { backgroundColor: color.data.shares[i] }, i === 0 && styles.stripFirst, i === last && styles.stripLast]} />
          </Pressable>
        ))}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.legend}>
        {month.shares.map((s, i) => (
          <Pressable key={s.key} testID={`month-legend-${s.key}`} onPress={() => choose(s.key)} style={[styles.item, dim(s.key)]}>
            <View testID={`month-dot-${s.key}`} style={[styles.dot, { backgroundColor: color.data.shares[i] }]} />
            <View style={styles.name}>
              <Text style={styles.nameText} numberOfLines={1}>
                {s.name}
              </Text>
              {s.above && <Icon name="arrowUp" color={color.limit.low} size={12} />}
            </View>
            {/* The sum never gives way and is never cut: only the name shrinks. */}
            <Text style={styles.amount}>{formatMoney(s.amount)}</Text>
          </Pressable>
        ))}
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.phrase}>
        {current ? current.phrase : HINT}
      </Text>
    </View>
  );
}

function Pill({ comparison }: { comparison: NonNullable<Month["comparison"]> }) {
  // Sage only for a month below the one before; above or level it is quiet, and never sand or red.
  const down = comparison.direction === "down";
  const tone = down ? color.accent.signal : color.fg.muted;
  return (
    <View testID="month-pill" style={[styles.pill, { backgroundColor: down ? color.accent.signalSoft : color.surface.raised }]}>
      {comparison.direction !== "same" && <Icon name={down ? "arrowDown" : "arrowUp"} color={tone} size={12} />}
      <Text style={[styles.pillText, { color: tone }]}>{comparison.text}</Text>
    </View>
  );
}

/** How much of a share stays when another is chosen, as in the mockup. */
const DIMMED = 0.3;
const STRIP = 12;
const STRIP_RADIUS = 5;
/** The header is `touchMin` tall with its 20 pt title line in the middle: this much of it is air above and below. */
const HEAD_AIR = (touchMin - type.label.lineHeight) / 2;
/** The air above and below the strip inside its 44 pt buttons. */
const BAR_AIR = (touchMin - STRIP) / 2;

const styles = StyleSheet.create({
  // With the header's own air and the screen's gap, `SECTION_GAP` stands above the title.
  section: { marginTop: SECTION_MARGIN - HEAD_AIR },
  head: { minHeight: touchMin, justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 2 },
  pillText: { ...type.caption, fontVariant: ["tabular-nums"] },
  sumRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  sum: { fontSize: 30, lineHeight: 34, fontWeight: "500", letterSpacing: -1, color: color.fg.default, fontVariant: ["tabular-nums"] },
  // Its own spacing is the small gap between the sign and the figure.
  sign: { fontSize: 15, letterSpacing: 2, color: color.fg.subtle },
  average: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"], flexShrink: 1, textAlign: "right" },
  // The strip sits 12 pt under the sum and 12 pt over the names' rows; the buttons' air overlaps what is around them.
  bar: { flexDirection: "row", gap: 2, marginTop: space.md - BAR_AIR, marginBottom: -BAR_AIR },
  share: { flexBasis: 0, flexShrink: 1, minWidth: 3, minHeight: touchMin, justifyContent: "center" },
  strip: { height: STRIP },
  stripFirst: { borderTopLeftRadius: STRIP_RADIUS, borderBottomLeftRadius: STRIP_RADIUS },
  stripLast: { borderTopRightRadius: STRIP_RADIUS, borderBottomRightRadius: STRIP_RADIUS },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: space.xs },
  item: { width: "47%", minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  name: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2 },
  nameText: { ...type.label, fontWeight: "400", color: color.fg.default, flexShrink: 1 },
  amount: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"], flexShrink: 0 },
  // Room for two lines, so choosing a share does not move what is below.
  phrase: { ...type.label, fontWeight: "400", color: color.fg.muted, minHeight: type.label.lineHeight * 2 },
});
