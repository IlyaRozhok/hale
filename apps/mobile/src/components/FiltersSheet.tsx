import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { useCategoryList } from "../api/queries";
import { categoryIconOf } from "../categoryIcon";
import { lastDays } from "../format";
import { categoryChoices } from "../labels";
import { Chip } from "./Chip";
import { DateField } from "./DateField";
import { Icon } from "./Icon";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

export type Period = { from: string; to: string };
export type Filters = { period: Period | null; category: string | null };

type Props = {
  today: string;
  value: Filters;
  /** Categories are spending's: offered wherever spending is listed, not for income. Where they are not
   *  offered, "Показать" passes the incoming category through and only "Сбросить" clears it. */
  withCategories: boolean;
  onApply: (f: Filters) => void;
  onClose: () => void;
};

const same = (a: Period | null, b: Period) =>
  a !== null && a.from === b.from && a.to === b.to;

/** Everything that narrows the list, in one window: a period, and where spending is listed a category. */
export function FiltersSheet({
  today,
  value,
  withCategories,
  onApply,
  onClose,
}: Props) {
  const [period, setPeriod] = useState<Period | null>(value.period);
  const [category, setCategory] = useState<string | null>(value.category);
  const list = useCategoryList();
  const quick: { label: string; period: Period }[] = [
    { label: "Сегодня", period: { from: today, to: today } },
    { label: "Неделя", period: lastDays(today, 7) },
    // Not the calendar month: on the 2nd that would be two days.
    { label: "Месяц", period: lastDays(today, 30) },
  ];
  const apply = (f: Filters) => {
    onApply(f);
    onClose();
  };
  return (
    <Sheet title="Фильтры" onClose={onClose}>
      <Text style={styles.heading}>Период</Text>
      <View style={styles.chips}>
        {quick.map((q) => (
          <Chip
            key={q.label}
            label={q.label}
            selected={same(period, q.period)}
            onPress={() => setPeriod(same(period, q.period) ? null : q.period)}
          />
        ))}
      </View>
      {/* Empty until a period is chosen. One date alone makes a whole period, and both fields show it:
          a start runs to today, an end is that one day. */}
      <DateField
        label="С"
        value={period?.from ?? ""}
        onChange={(d) => setPeriod({ from: d, to: !period ? today : d > period.to ? d : period.to })}
        max={today}
      />
      <DateField
        label="По"
        value={period?.to ?? ""}
        onChange={(d) => setPeriod({ from: !period || d < period.from ? d : period.from, to: d })}
        max={today}
      />
      {withCategories && (
        <>
          <Text style={styles.heading}>Категория</Text>
          <View style={styles.chips}>
            {categoryChoices(list).map(({ key: c, name }) => {
              const on = category === c;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  accessibilityState={{ selected: on }}
                  onPress={() => setCategory(on ? null : c)}
                  hitSlop={space.xs}
                style={[styles.pill, on && styles.pillOn]}
                >
                  <Icon
                    name={categoryIconOf(c, list)}
                    color={on ? color.accent.fgOnAccent : color.fg.muted}
                    size={16}
                  />
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      {/* Without the category block the category is the one that came in: remembered for spending, not erased here. */}
      <PrimaryButton
        label="Показать"
        onPress={() => apply({ period, category })}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Сбросить"
        onPress={() => apply({ period: null, category: null })}
        style={styles.reset}
      >
        <Text style={styles.resetText}>Сбросить</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.label, color: color.fg.subtle },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  pill: {
    minHeight: touchMin - space.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    backgroundColor: color.surface.overlay,
  },
  pillOn: { backgroundColor: color.accent.default },
  pillText: { ...type.caption, color: color.fg.default },
  pillTextOn: { color: color.accent.fgOnAccent },
  reset: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: { ...type.label, color: color.fg.muted },
});
