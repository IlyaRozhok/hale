import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";
import type { TransactionDto } from "@tablo/contracts";
import { formatMoney, formatOriginal, shortDate } from "../format";
import { categoryLabel, typeLabel } from "../labels";

const { color, radius, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onPress: () => void };

/** One operation: hryvnias first, the original currency noted. No money is calculated here. */
export function TxRow({ tx, onPress }: Props) {
  const foreign = tx.currency !== "UAH";
  const original = formatOriginal(tx.amount, tx.currency);
  const main = tx.amountUah !== null ? formatMoney(tx.amountUah) : original;
  const title = tx.counterName ?? tx.description;
  const kind = `${categoryLabel(tx.category)} · ${typeLabel(tx.type)}`;
  const when = tx.hold ? `${shortDate(tx.localDate)} · в обработке` : shortDate(tx.localDate);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.note}>{kind}</Text>
        <Text style={styles.note}>{when}</Text>
        {tx.needsLabel ? <Text style={styles.ask}>Ждёт ответа</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>{main}</Text>
        {foreign && tx.amountUah !== null ? <Text style={styles.note}>{original}</Text> : null}
        {foreign && tx.amountUah === null ? <Text style={styles.note}>курс неизвестен</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface.inset,
  },
  left: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: 2 },
  title: { ...type.body, color: color.fg.default },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  ask: { ...type.label, color: color.fg.default },
});
