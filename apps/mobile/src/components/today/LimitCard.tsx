import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { DailyStateDto } from "@hale/contracts";
import { LimitBar } from "../../metal";
import { limitState } from "../../limitState";
import { formatMoney, streakLabel } from "../../format";
import { useCountUp } from "../../useEntrance";
import { Icon } from "../Icon";
import { LAYOUT } from "../layout";

const { color, radius, space, touchMin, type } = tokens;

/** An overspent day: there is a limit and more than it is spent. The screen keeps the phrase of the day quiet on it. */
export const isOverLimit = (state: DailyStateDto): boolean => state.dailyLimit > 0 && state.leftToday < 0;

/**
 * The limit section of «Сегодня»: «Сегодня можно», the amount left, the strip and the line under it. Since ЧЛ3 it is
 * not a card: it stands on the screen itself, with no glass and no fill (the file keeps its name from ЧЛ1).
 *
 * Contract: everything is derived from `state`; the section holds no state of its own. The heading is plain text.
 * What is under the figure calls `onOpenCalendar`: the strip and the line (one button for VoiceOver — the line; the
 * strip is a second place to touch), or, with no limit, the note.
 * With `onOpenParts` and a limit (task ЧЛ4) the chip «Как посчитано» at the right of the line calls it, and so does
 * the figure (one button for VoiceOver — the chip; the figure is a second place to touch). The screen gives it only
 * when there is something to explain the figure with; without it there is no chip and the figure is plain text.
 * Its states:
 * - a limit and money left — the strip and «потрачено ₴X из ₴L»;
 * - nothing left or overspent — «₴0» and only «завтра снова ₴L» (tasks Я2, ЯМ1);
 * - the day the shortage mode came on (`state.shortageStart`) — «Новый лимит ₴Y действует с завтра» instead of the line;
 * - no limit — a note why, and «Потрачено ₴X» when something was spent.
 * `streak` only extends the accessibility hint.
 * `entrance` is the screen's entrance key (task ЧЛ8; 0 or absent — no motion): with a new one the figure counts up to
 * its amount and the strip grows to its length. The amount itself is laid out and read aloud from the first frame —
 * the counting figure is drawn over it — so nothing moves around it and VoiceOver never hears a figure on the way.
 * «₴0» has nothing to count, and a day over the limit does not grow its red strip.
 */
export function LimitCard({
  state,
  streak,
  onOpenCalendar,
  onOpenParts,
  entrance = 0,
}: {
  state: DailyStateDto;
  streak: number;
  onOpenCalendar: () => void;
  onOpenParts?: () => void;
  entrance?: number;
}) {
  const level = state.leftToday > 0 ? Math.min(1, Math.max(0, state.level)) : 0;
  const hasLimit = state.dailyLimit > 0;
  const over = isOverLimit(state);
  const spent = Math.max(0, state.dailyLimit - state.leftToday);
  const shownLeft = over ? -state.leftToday : Math.max(0, state.leftToday);
  // Owner's choice: an overspent day looks like any day; only the strip's spark turns red.
  const heading = "Сегодня можно";
  const dayState = limitState(state);
  // The day the shortage mode came on, while it still runs on the limit it began with: what is already spent
  // is not set against the new one. Once the day's limit is the new one the server names none for tomorrow.
  const nextLimit = state.shortageStart?.nextLimit;
  const nextLimitNote = nextLimit !== undefined ? `Новый лимит ${formatMoney(nextLimit)} действует с завтра` : null;
  const noLimitNote = state.mode === "bridge" ? "Лимит появится, когда вы подтвердите план." : "До следующего дохода свободных денег нет.";
  // Tasks Я2, ЯМ1: once nothing is left the line says only tomorrow's limit (the owner's mockup); what was spent is in the calendar.
  const spentLine = state.leftToday <= 0 ? `завтра снова ${formatMoney(state.dailyLimit)}` : `потрачено ${formatMoney(spent)} из ${formatMoney(state.dailyLimit)}`;
  // Task ЯМ7: what touching the line does, then the streak when there is one.
  const calendarHint = streak > 0 ? `Открывает календарь. ${streakLabel(streak)}` : "Открывает календарь";
  const limitLabel = hasLimit && nextLimitNote
    ? `${heading} ${formatMoney(over ? 0 : shownLeft)}. ${nextLimitNote}`
    : hasLimit && state.leftToday <= 0
    ? `${heading} ${formatMoney(0)}, завтра снова ${formatMoney(state.dailyLimit)}`
    : hasLimit
      ? `${heading} ${formatMoney(shownLeft)}, из ${formatMoney(state.dailyLimit)} на день`
      : `${heading} ${formatMoney(shownLeft)}. ${noLimitNote}`;

  // Never below zero here, so it always starts with the sign: the sign is drawn half the size and quiet.
  const left = over ? 0 : shownLeft;
  const figure = formatMoney(left);
  const openParts = hasLimit ? onOpenParts : undefined;
  const counted = useCountUp(left, entrance);
  const counting = counted === null ? null : formatMoney(counted);
  const amount = (
    <View>
      {/* While the figure counts, the amount keeps its place with clear ink and the count is drawn over it. */}
      <Text style={[styles.amount, counting !== null && styles.clear]}>
        <Text style={[styles.sign, counting !== null && styles.clear]}>{figure.slice(0, 1)}</Text>
        {figure.slice(1)}
      </Text>
      {counting !== null && (
        <Text testID="limit-count" style={[styles.amount, styles.count]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" numberOfLines={1}>
          <Text style={styles.sign}>{counting.slice(0, 1)}</Text>
          {counting.slice(1)}
        </Text>
      )}
    </View>
  );

  return (
    <View testID="limit-section" style={[styles.section, !hasLimit && styles.sectionNoLimit]}>
      <Text style={styles.eyebrow}>{heading}</Text>
      {openParts ? (
        // A second place to touch for the chip below: VoiceOver reads the figure as text and has the chip as the button.
        <Pressable testID="limit-figure" accessible={false} onPress={openParts} style={styles.figurePress}>
          {amount}
        </Pressable>
      ) : (
        amount
      )}
      {!hasLimit && (
        <Pressable accessibilityRole="button" accessibilityLabel={limitLabel} accessibilityHint={calendarHint} onPress={onOpenCalendar} style={styles.notes}>
          <Text style={styles.note}>{noLimitNote}</Text>
          {spent > 0 && <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text>}
        </Pressable>
      )}
      {hasLimit && (
        <>
          {/* The strip opens the calendar too. VoiceOver gets one button, the line below. */}
          <Pressable
            testID="limit-bar"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={onOpenCalendar}
            style={styles.bar}
          >
            <LimitBar level={level} state={dayState} entrance={entrance} />
          </Pressable>
          {/* The line at the left; with something to explain, the «Как посчитано» chip at its right (ЧЛ4). */}
          <View style={styles.lineRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={limitLabel} accessibilityHint={calendarHint} onPress={onOpenCalendar} style={styles.linePress}>
              {/* Task ЯМ7: a quiet chevron says the line opens something; the line wraps, the chevron stays centred at the right. */}
              <View testID="limit-line" style={styles.spentLine}>
                <Text style={[styles.subtle, openParts ? styles.spentTextBesideChip : styles.spentText]}>{nextLimitNote ?? spentLine}</Text>
                <View testID="limit-chevron" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Icon name="chevron" color={color.list.chevron} size={14} />
                </View>
              </View>
            </Pressable>
            {openParts && (
              <Pressable accessibilityRole="button" accessibilityLabel={PARTS_LABEL} accessibilityHint={PARTS_HINT} onPress={openParts} style={styles.chipPress}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{PARTS_LABEL}</Text>
                  <Icon name="chevron" color={color.list.chevron} size={12} />
                </View>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** Whole phrases, so they can be translated as they are. */
const PARTS_LABEL = "Как посчитано";
const PARTS_HINT = "Открывает расчёт лимита";

/** The strip's canvas is taller than the strip by its glow, above and below (`LimitBar`). */
const BAR_GLOW = 6;
/** The mockup's distances: the figure to the strip, the strip to the line, one section to the next. */
const FIGURE_TO_BAR = 14;
const BAR_TO_LINE = 10;
const SECTION_GAP = 26;
/** The screen already puts `space.md` between its rows. */
const ROW_GAP = space.md;
/** The line's button is `touchMin` tall with the text in the middle: this much of it is air above and below the text. */
const LINE_AIR = (touchMin - type.caption.lineHeight) / 2;

const styles = StyleSheet.create({
  // With a limit the air under the line's text and the screen's own gap already make the distance to the next section.
  section: { marginTop: SECTION_GAP - ROW_GAP, marginBottom: Math.max(0, SECTION_GAP - ROW_GAP - LINE_AIR) },
  sectionNoLimit: { marginBottom: SECTION_GAP - ROW_GAP },
  eyebrow: { ...type.body, color: color.fg.muted, height: LAYOUT.eyebrow + 4 },
  amount: { ...type.hero, marginTop: space.xs, color: color.fg.default, fontVariant: ["tabular-nums"] },
  // Its own spacing is the small gap between the sign and the figure.
  sign: { fontSize: type.hero.fontSize / 2, letterSpacing: 3, color: color.fg.subtle },
  clear: { color: "transparent" },
  count: { position: "absolute", left: 0, top: 0 },
  bar: { paddingTop: FIGURE_TO_BAR - BAR_GLOW },
  // The button reaches up over the strip's lower glow, so the text sits where the mockup has it and the target stays 44 pt.
  lineRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: BAR_TO_LINE - BAR_GLOW - LINE_AIR },
  linePress: { flex: 1, minHeight: touchMin, justifyContent: "center" },
  spentLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  spentText: { flex: 1 },
  // Beside the chip the line is as wide as its words, so its chevron stays with them and not against the chip.
  spentTextBesideChip: { flexShrink: 1 },
  // Only the figure itself is touched, not the empty row at its right; its line is taller than `touchMin`.
  figurePress: { minHeight: touchMin, alignSelf: "flex-start" },
  // The button is `touchMin` tall; the pill inside it is as small as in the mockup.
  chipPress: { minHeight: touchMin, justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderColor: color.data.grid, borderRadius: radius.full, paddingLeft: 10, paddingRight: 6, paddingVertical: space.xs },
  chipText: { ...type.caption, color: color.fg.muted },
  notes: { minHeight: touchMin, justifyContent: "center", marginTop: space.xs, gap: 2 },
  note: { ...type.body, color: color.fg.muted },
  subtle: { ...type.caption, color: color.fg.subtle },
});
