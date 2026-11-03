import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { amountTone, formatOriginal, formatSignedMoney, formatSignedOriginal } from "../format";
import { categoryLabel, typeLabel } from "../labels";

const { color, radius, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onPress: () => void; first: boolean; last: boolean };

const TONES = { expense: color.money.expense, income: color.money.income, neutral: color.money.neutral };

/** One operation: hryvnias first, the original currency noted. No money is calculated here. */
export function TxRow({ tx, onPress, first, last }: Props) {
  const foreign = tx.currency !== "UAH";
  const main = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  const title = tx.counterName ?? tx.description;
  const kind = tx.type === "spend" ? categoryLabel(tx.category) : typeLabel(tx.type);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, first && styles.first, last && styles.last]}>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.note}>{tx.hold ? `${kind} · в обработке` : kind}</Text>
        {tx.needsLabel ? <Text style={styles.ask}>Ждёт ответа</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: TONES[amountTone(tx.type, tx.amount)] }]}>{main}</Text>
        {foreign && tx.amountUah !== null ? <Text style={styles.note}>{formatOriginal(tx.amount, tx.currency)}</Text> : null}
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
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: color.glass.row,
  },
  first: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.md },
  last: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: space.md },
  left: { flex: 1 },
  right: { alignItems: "flex-end" },
  title: { ...type.body, color: color.fg.default },
  amount: { ...type.body, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  ask: { ...type.label, color: color.fg.default },
});
