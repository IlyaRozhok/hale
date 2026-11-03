import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";
import { Glass } from "./Glass";

const { color, radius, space, type } = tokens;

const SHOWN = 3;

type Props = { items: TodayDto["upcoming"] };

/** The next payments; the total covers all of them, not only the ones shown. */
export function Upcoming({ items }: Props) {
  if (items.length === 0) return null;
  const total = items.reduce((sum, p) => sum + p.amount, 0);
  return (
    <Glass style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.caption}>Скоро платить</Text>
        {items.length > 1 ? <Text style={styles.caption}>{formatMoney(total)}</Text> : null}
      </View>
      {items.slice(0, SHOWN).map((p) => {
        const { day, month } = dayMonth(p.dueOn);
        return (
          <View key={p.id} style={styles.row}>
            <View style={styles.tile}>
              <Text style={styles.day}>{day}</Text>
              <Text style={styles.month}>{month}</Text>
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {p.name}
            </Text>
            <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
          </View>
        );
      })}
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, backgroundColor: color.surface.inset },
  head: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  caption: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.surface.overlay },
  day: { ...type.label, lineHeight: 16, color: color.fg.default, fontVariant: ["tabular-nums"] },
  month: { ...type.caption, lineHeight: 14, color: color.fg.subtle },
  name: { ...type.body, color: color.fg.default, flex: 1 },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
