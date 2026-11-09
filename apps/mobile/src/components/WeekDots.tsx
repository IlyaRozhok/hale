import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CalendarDayDto } from "@hale/contracts";
import { useCalendar } from "../api/queries";
import { shiftDate, streakLabel } from "../format";
import type { LimitState } from "../limitState";
import { Icon } from "./Icon";

const { color, space, touchMin, type } = tokens;

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const DOT = 8;

type Status = "within" | "over" | "no_limit" | "today";
const DOT_COLOR: Record<Exclude<Status, "today">, string> = {
  within: color.calendar.within,
  over: color.calendar.over,
  no_limit: color.data.track,
};
const SPARK: Record<LimitState, string> = { ok: color.limit.ok, low: color.limit.low, over: color.limit.over };

const statusOf = (d: CalendarDayDto | undefined): Status =>
  !d ? "no_limit" : d.status === "far_over" ? "over" : d.status;

/**
 * The week up to today as dots: green within the limit, red over it, grey with no limit; today a
 * ring in the colour of the limit strip's spark. The whole row opens the limit calendar.
 */
export function WeekDots({ today, streak, state, onPress }: { today: string; streak: number; state: LimitState; onPress: () => void }) {
  const week = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6));
  const month = today.slice(0, 7);
  const earlier = week[0]!.slice(0, 7);
  const current = useCalendar(month);
  const previous = useCalendar(earlier, earlier !== month);
  const days = [...(previous.data?.days ?? []), ...(current.data?.days ?? [])];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={streakLabel(streak)} onPress={onPress} style={styles.row}>
      {week.map((date) => {
        const status: Status = date === today ? "today" : statusOf(days.find((d) => d.date === date));
        const weekday = WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
        return (
          <View key={date} testID={`week-day-${date}`} accessibilityHint={status} style={styles.day}>
            <View style={status === "today" ? [styles.ring, { borderColor: SPARK[state] }] : [styles.dot, { backgroundColor: DOT_COLOR[status] }]} />
            <Text style={[styles.label, date === today && styles.today]}>{weekday}</Text>
          </View>
        );
      })}
      <Icon name="chevron" color={color.fg.subtle} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.xs },
  day: { alignItems: "center", gap: space.xs, minWidth: 24 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  ring: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5 },
  label: { ...type.caption, color: color.fg.subtle },
  today: { color: color.fg.default },
});
