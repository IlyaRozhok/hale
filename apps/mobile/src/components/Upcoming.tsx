import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";

const { color, radius, space, touchMin, type } = tokens;

const SHOWN = 3;

type Item = TodayDto["upcoming"][number];
type Props = { items: Item[]; today: string; onPress: (item: Item) => void };

/** The next payments; the total covers all of them, not only the ones shown. A past due date is marked. */
export function Upcoming({ items, today, onPress }: Props) {
  if (items.length === 0) return null;
  const total = items.reduce((sum, p) => sum + p.amount, 0);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.caption}>Скоро платить</Text>
        {items.length > 1 ? <Text style={styles.caption}>{formatMoney(total)}</Text> : null}
      </View>
      {items.slice(0, SHOWN).map((p) => {
        const { day, month } = dayMonth(p.dueOn);
        const overdue = p.dueOn < today;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${formatMoney(p.amount)}${overdue ? ", просрочен" : ""}`}
            onPress={() => onPress(p)}
            style={styles.row}
          >
            <View style={styles.tile}>
              <Text style={[styles.day, overdue && styles.danger]}>{day}</Text>
              <Text style={[styles.month, overdue && styles.danger]}>{month}</Text>
            </View>
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={2}>
                {p.name}
              </Text>
              {overdue && <Text style={[styles.month, styles.danger]}>просрочен</Text>}
            </View>
            <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, paddingHorizontal: space.xs },
  head: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  caption: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  text: { flex: 1 },
  danger: { color: color.status.danger },
  tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.surface.overlay },
  day: { ...type.label, lineHeight: 16, color: color.fg.default, fontVariant: ["tabular-nums"] },
  month: { ...type.caption, lineHeight: 14, color: color.fg.subtle },
  name: { ...type.body, color: color.fg.default },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
