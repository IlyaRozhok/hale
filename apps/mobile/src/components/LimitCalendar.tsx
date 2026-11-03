import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CalendarDayDto } from "@hale/contracts";
import { useCalendar } from "../api/queries";
import { dateLabel, formatMoney, monthGrid, monthTitle, streakLabel } from "../format";
import { ErrorText } from "./ErrorText";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const WORDS: Record<CalendarDayDto["status"], string> = {
  within: "в лимите",
  over: "сверх лимита",
  far_over: "сильно сверх лимита",
  no_limit: "лимита не было",
  today: "сегодня",
};

const FILLS: Partial<Record<CalendarDayDto["status"], string>> = {
  within: color.calendar.within,
  over: color.calendar.over,
  far_over: color.calendar.farOver,
};

const LEGEND = [
  { fill: color.calendar.within, text: WORDS.within },
  { fill: color.calendar.over, text: WORDS.over },
  { fill: color.calendar.farOver, text: "больше 150%" },
];

const figures = (d: CalendarDayDto) =>
  `${dateLabel(d.date).replace(/ \d{4}$/, "")}: потрачено ${formatMoney(d.spent)}${d.limit !== null && d.limit > 0 ? ` из ${formatMoney(d.limit)}` : ", лимита не было"}`;

/** "2026-11" and a number of months later. */
function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** A month of days coloured by how they went against the limit, with the current streak. */
export function LimitCalendar({ today, streak, onClose }: { today: string; streak: number; onClose: () => void }) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [picked, setPicked] = useState<CalendarDayDto | null>(null);
  const calendar = useCalendar(month);
  const byDate = new Map((calendar.data?.month === month ? calendar.data.days : []).map((d) => [d.date, d]));
  const go = (by: number) => {
    setPicked(null);
    setMonth(shiftMonth(month, by));
  };

  return (
    <Sheet title="Календарь лимитов" subtitle={streakLabel(calendar.data?.streak ?? streak)} onClose={onClose}>
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
        <View style={styles.grid}>
          {WEEKDAYS.map((d) => (
            <Text key={d} style={styles.weekday}>{d}</Text>
          ))}
          {monthGrid(Number(month.slice(0, 4)), Number(month.slice(5, 7))).map((date, i) => {
            const day = date ? byDate.get(date) : undefined;
            if (!date || !day) {
              return (
                <View key={date ?? `blank-${i}`} style={styles.slot}>
                  {date ? <Text style={styles.future}>{Number(date.slice(8))}</Text> : null}
                </View>
              );
            }
            return <Day key={date} day={day} onPress={() => setPicked(day)} />;
          })}
        </View>
      )}
      {picked && <Text style={styles.detail}>{figures(picked)}</Text>}
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.text} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: l.fill }]} />
            <Text style={styles.legendText}>{l.text}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function Day({ day, onPress }: { day: CalendarDayDto; onPress: () => void }) {
  const fill = FILLS[day.status];
  const label = `${dateLabel(day.date).replace(/ \d{4}$/, "")}: ${WORDS[day.status]}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.slot, styles.day, fill ? { backgroundColor: fill } : null, day.status === "today" ? styles.today : null]}
    >
      <Text style={[styles.number, fill ? styles.numberOnFill : day.status === "no_limit" ? styles.numberQuiet : null]}>{Number(day.date.slice(8))}</Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.28%", textAlign: "center", ...type.caption, color: color.fg.subtle, paddingBottom: space.xs },
  slot: { width: "14.28%", minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  day: { borderRadius: radius.md, borderWidth: 2, borderColor: "transparent" },
  today: { borderColor: color.fg.default },
  number: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  numberOnFill: { color: color.fg.inverse },
  numberQuiet: { color: color.fg.subtle },
  future: { ...type.body, color: color.fg.subtle, opacity: 0.4, fontVariant: ["tabular-nums"] },
  detail: { ...type.body, color: color.fg.default },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  legendText: { ...type.caption, color: color.fg.muted },
});
