import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { DailyStateDto } from "@hale/contracts";
import { LimitBar } from "../../metal";
import { limitState } from "../../limitState";
import { formatMoney, streakLabel } from "../../format";
import { Glass } from "../Glass";
import { Icon } from "../Icon";
import { LAYOUT } from "../layout";

const { color, radius, space, touchMin, type } = tokens;

/** An overspent day: there is a limit and more than it is spent. The screen keeps the phrase of the day quiet on it. */
export const isOverLimit = (state: DailyStateDto): boolean => state.dailyLimit > 0 && state.leftToday < 0;

/**
 * The limit card of «Сегодня»: «Сегодня можно», the amount left, the strip and the line under it.
 *
 * Contract: everything is derived from `state`; the card holds no state of its own. The whole card is one button
 * that calls `onOpenCalendar`. Its states:
 * - a limit and money left — the strip and «потрачено ₴X из ₴L»;
 * - nothing left or overspent — «₴0» and only «завтра снова ₴L» (tasks Я2, ЯМ1);
 * - the day the shortage mode came on (`state.shortageStart`) — «Новый лимит ₴Y действует с завтра» instead of the line;
 * - no limit — a note why, and «Потрачено ₴X» when something was spent.
 * `streak` only extends the accessibility hint.
 */
export function LimitCard({ state, streak, onOpenCalendar }: { state: DailyStateDto; streak: number; onOpenCalendar: () => void }) {
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
  // Task ЯМ7: what touching the card does, then the streak when there is one.
  const calendarHint = streak > 0 ? `Открывает календарь. ${streakLabel(streak)}` : "Открывает календарь";
  const limitLabel = hasLimit && nextLimitNote
    ? `${heading} ${formatMoney(over ? 0 : shownLeft)}. ${nextLimitNote}`
    : hasLimit && state.leftToday <= 0
    ? `${heading} ${formatMoney(0)}, завтра снова ${formatMoney(state.dailyLimit)}`
    : hasLimit
      ? `${heading} ${formatMoney(shownLeft)}, из ${formatMoney(state.dailyLimit)} на день`
      : `${heading} ${formatMoney(shownLeft)}. ${noLimitNote}`;

  return (
    // The whole card is the way into the limit calendar.
    <Pressable accessibilityRole="button" accessibilityLabel={limitLabel} accessibilityHint={calendarHint} onPress={onOpenCalendar} style={styles.heroPress}>
      <Glass kind="card" style={styles.hero}>
        <Text style={styles.eyebrow}>{heading}</Text>
        <Text style={styles.amount}>{over ? formatMoney(0) : formatMoney(shownLeft)}</Text>
        {!hasLimit && <Text style={styles.note}>{noLimitNote}</Text>}
        {!hasLimit && spent > 0 && <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text>}
        {hasLimit && (
          <>
            <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <LimitBar level={level} state={dayState} />
            </View>
            {/* Task ЯМ7: a quiet chevron says the card opens something; the line wraps, the chevron stays centred at the right. */}
            <View testID="limit-line" style={styles.spentLine}>
              <Text style={[styles.subtle, styles.spentText]}>{nextLimitNote ?? spentLine}</Text>
              <View testID="limit-chevron" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Icon name="chevron" color={color.list.chevron} size={14} />
              </View>
            </View>
          </>
        )}
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroPress: { minHeight: touchMin },
  hero: { overflow: "hidden", borderRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg, gap: 2 },
  bar: { marginTop: space.md },
  spentLine: { marginTop: space.xs, flexDirection: "row", alignItems: "center", gap: space.sm },
  spentText: { flex: 1 },
  eyebrow: { ...type.body, color: color.fg.muted, height: LAYOUT.eyebrow + 4 },
  amount: { ...type.amount, lineHeight: LAYOUT.amount, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.body, color: color.fg.muted },
  subtle: { ...type.caption, color: color.fg.subtle },
});
