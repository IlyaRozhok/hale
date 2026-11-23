import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CalendarDayDto } from "@hale/contracts";
import { useCalendar } from "../api/queries";
import { dayMonthLong, formatMoney, monthGrid, monthTitle, shortDate, streakLabel } from "../format";
import { ErrorText } from "./ErrorText";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

/** Half the gap between days. */
const INSET = 2;
/** The dot under a day's number. */
const DOT = 5;

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// Task А24, variant А: any day over the limit is one quiet grey mark, however far over; the calendar has no red.
const WORDS: Record<CalendarDayDto["status"], string> = {
  within: "в лимите",
  over: "больше лимита",
  far_over: "больше лимита",
  no_limit: "лимита не было",
  today: "сегодня",
};

const DOTS: Partial<Record<CalendarDayDto["status"], string>> = {
  within: color.calendar.within,
  over: color.fg.subtle,
  far_over: color.fg.subtle,
};

const LEGEND = [
  { fill: color.calendar.within, text: WORDS.within },
  { fill: color.fg.subtle, text: WORDS.over },
];

/** The full date without the year, «2 ноября», for VoiceOver. */
const dayName = (d: CalendarDayDto) => dayMonthLong(d.date);

/**
 * What was spent on the day, after the day's name: «2 ноя» on the screen, the full date for VoiceOver.
 * The day the shortage mode came on is not rated: what was spent before the new limit is not set against it.
 */
const figures = (d: CalendarDayDto, name: string) =>
  d.shortageStart
    ? `${name}: потрачено ${formatMoney(d.spent)}. В этот день изменился лимит, день без оценки.`
    : `${name}: потрачено ${formatMoney(d.spent)}${d.limit !== null && d.limit > 0 ? ` из ${formatMoney(d.limit)}` : ", лимита не было"}`;

/** "2026-11" and a number of months later. */
function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

type Props = {
  today: string;
  streak: number;
  onClose: () => void;
  /** Leads to the operations of the picked day. */
  onOpenDay: (date: string) => void;
};

/** A month of days, each with a dot for how it went against the limit, and the current streak. */
export function LimitCalendar({ today, streak, onClose, onOpenDay }: Props) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [picked, setPicked] = useState<CalendarDayDto | null>(null);
  const calendar = useCalendar(month);
  const byDate = new Map((calendar.data?.month === month ? calendar.data.days : []).map((d) => [d.date, d]));
  const grid = monthGrid(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const streakNow = calendar.data?.streak ?? streak;
  const go = (by: number) => {
    setPicked(null);
    setMonth(shiftMonth(month, by));
  };

  return (
    <Sheet title="Календарь лимитов" subtitle={streakNow > 0 ? streakLabel(streakNow) : undefined} onClose={onClose}>
      <View style={styles.head}>
        <Arrow label="Предыдущий месяц" text="‹" onPress={() => go(-1)} />
        <Text style={styles.title}>{monthTitle(Number(month.slice(0, 4)), Number(month.slice(5, 7)))}</Text>
        <Arrow label="Следующий месяц" text="›" disabled={month >= thisMonth} onPress={() => go(1)} />
      </View>
      {calendar.isError && !calendar.data ? (
        <>
          <ErrorText>Не получилось загрузить месяц.</ErrorText>
          <PrimaryButton label="Повторить" onPress={() => void calendar.refetch()} />
        </>
      ) : (
        <>
          <View style={styles.row}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={styles.weekday}>{d}</Text>
            ))}
          </View>
          <View style={styles.row}>
            {grid.map((date, i) => {
              const day = date ? byDate.get(date) : undefined;
              if (!date || !day) {
                return (
                  <View key={date ?? `blank-${i}`} style={styles.slot}>
                    {date ? <Text style={styles.future}>{Number(date.slice(8))}</Text> : null}
                    {date ? <View style={styles.dot} /> : null}
                  </View>
                );
              }
              return <Day key={date} day={day} picked={picked?.date === date} onPress={() => setPicked(day)} />;
            })}
          </View>
        </>
      )}
      {picked && (
        <View>
          <Text style={styles.detail} accessibilityLabel={figures(picked, dayName(picked))}>
            {figures(picked, shortDate(picked.date))}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Операции дня" onPress={() => onOpenDay(picked.date)} style={styles.link}>
            <Text style={styles.linkText}>Операции дня</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.text} style={styles.legendItem}>
            <View testID="calendar-legend-dot" style={[styles.legendDot, { backgroundColor: l.fill }]} />
            <Text style={styles.legendText}>{l.text}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function Day({ day, picked, onPress }: { day: CalendarDayDto; picked: boolean; onPress: () => void }) {
  const dot = DOTS[day.status];
  // Grey like a day without a limit (a quiet number, no dot), but named for what it was.
  const label = `${dayName(day)}: ${day.shortageStart && day.status !== "today" ? "изменился лимит" : WORDS[day.status]}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.slot}>
      <View testID={`calendar-day-${day.date}`} style={[styles.day, day.status === "today" && styles.ringToday, picked && styles.ringPicked]}>
        <Text style={[styles.number, (day.status === "no_limit" || day.shortageStart) && day.status !== "today" && styles.numberQuiet]}>{Number(day.date.slice(8))}</Text>
        {/* The dot's place is kept on days without one, so the numbers of a row stand on one line. */}
        {dot ? <View testID={`calendar-dot-${day.date}`} style={[styles.dot, { backgroundColor: dot }]} /> : <View style={styles.dot} />}
      </View>
    </Pressable>
  );
}

function Arrow({ label, text, disabled = false, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.arrow}>
      <Text style={[styles.title, disabled && styles.off]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...type.label, color: color.fg.default },
  off: { opacity: 0.3 },
  arrow: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.28%", textAlign: "center", ...type.caption, color: color.fg.subtle, paddingBottom: space.xs },
  slot: { width: "14.28%", minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  day: { alignSelf: "stretch", flex: 1, margin: INSET, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  ringToday: { borderWidth: 1, borderColor: color.fg.subtle },
  ringPicked: { borderWidth: 1, borderColor: color.fg.default },
  number: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  numberQuiet: { color: color.fg.subtle },
  future: { ...type.body, color: color.fg.subtle, opacity: 0.4, fontVariant: ["tabular-nums"] },
  detail: { ...type.body, color: color.fg.default },
  link: { alignSelf: "flex-start", minHeight: touchMin, justifyContent: "center" },
  linkText: { ...type.label, color: color.accent.default },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: DOT, height: DOT, borderRadius: radius.full },
  legendDot: { width: 10, height: 10, borderRadius: radius.full },
  legendText: { ...type.caption, color: color.fg.muted },
});
