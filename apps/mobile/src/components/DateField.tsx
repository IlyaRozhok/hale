import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { dateLabel, kyivDate, monthGrid, monthTitle, shortDate } from "../format";

const { color, radius, space, touchMin, type } = tokens;

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Props = {
  label: string;
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  /** What a screen reader names the field by, when the short label alone is ambiguous (several on one sheet). */
  accessibilityName?: string;
};

/** A date chosen on a month calendar that opens in place. */
export function DateField({ label, value, onChange, min, max, accessibilityName = label }: Props) {
  const [open, setOpen] = useState(false);
  const start = value || kyivDate();
  const [shown, setShown] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) });

  const step = (by: number) =>
    setShown(({ year, month }) => {
      const d = new Date(Date.UTC(year, month - 1 + by, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    });

  return (
    <View style={styles.stack}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityName}: ${value ? dateLabel(value) : "не выбрана"}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.field}
      >
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value ? shortDate(value, kyivDate()) : "Выбрать"}</Text>
      </Pressable>
      {open && (
        <View style={styles.calendar}>
          <View style={styles.head}>
            <Arrow label="Предыдущий месяц" text="‹" onPress={() => step(-1)} />
            <Text style={styles.title}>{monthTitle(shown.year, shown.month)}</Text>
            <Arrow label="Следующий месяц" text="›" onPress={() => step(1)} />
          </View>
          <View style={styles.grid}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={styles.weekday}>{d}</Text>
            ))}
            {monthGrid(shown.year, shown.month).map((date, i) =>
              date === null ? (
                <View key={`blank-${i}`} style={styles.cell} />
              ) : (
                <Day
                  key={date}
                  date={date}
                  selected={date === value}
                  disabled={(min !== undefined && date < min) || (max !== undefined && date > max)}
                  onPress={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                />
              ),
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function Arrow({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.arrow}>
      <Text style={styles.title}>{text}</Text>
    </Pressable>
  );
}

function Day({ date, selected, disabled, onPress }: { date: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dateLabel(date)}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.cell, selected && styles.selected]}
    >
      <Text style={[styles.day, selected && styles.selectedDay, disabled && styles.disabledDay]}>{Number(date.slice(8))}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  field: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.field.fill,
  },
  label: { ...type.body, color: color.fg.subtle },
  value: { ...type.body, color: color.fg.default },
  calendar: { padding: space.sm, borderRadius: radius.lg, backgroundColor: color.surface.inset },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...type.label, color: color.fg.default },
  arrow: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.28%", textAlign: "center", ...type.caption, color: color.fg.subtle },
  cell: { width: "14.28%", minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  selected: { backgroundColor: color.surface.selected },
  day: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  selectedDay: { color: color.fg.inverse },
  disabledDay: { color: color.fg.subtle, opacity: 0.5 },
});
