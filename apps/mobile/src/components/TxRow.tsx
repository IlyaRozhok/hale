import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { amountTone, formatOriginal, formatSignedMoney, formatSignedOriginal } from "../format";
import { categoryLabel, typeLabel } from "../labels";
import { categoryIcon } from "../categoryIcon";
import { Icon } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onPress: () => void; first: boolean; last: boolean };

// One accent: money in is green, everything else plain.
const TONES = { expense: color.money.neutral, income: color.accent.signal, neutral: color.money.neutral };
const BADGE = 36;

/** One operation: hryvnias first, the original currency noted. No money is calculated here. */
export function TxRow({ tx, onPress, first, last }: Props) {
  const foreign = tx.currency !== "UAH";
  const main = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  const title = tx.counterName ?? tx.description;
  const kind = tx.paymentName ?? (tx.type === "spend" ? categoryLabel(tx.category) : typeLabel(tx.type));
  const tone = amountTone(tx.type, tx.amount);
  const icon = categoryIcon(tx);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, first && styles.first, last && styles.last]}>
      <View testID={`tx-icon-${icon}`} style={styles.badge}>
        <Icon name={icon} color={tone === "income" ? color.accent.signal : color.fg.muted} size={18} />
      </View>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.note}>{kind}</Text>
        {tx.needsLabel ? <Text style={styles.ask}>Ждёт ответа</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: TONES[tone] }]}>{main}</Text>
        {foreign && tx.amountUah !== null ? <Text style={styles.note}>{formatOriginal(tx.amount, tx.currency)}</Text> : null}
        {foreign && tx.amountUah === null ? <Text style={styles.note}>курс неизвестен</Text> : null}
        {tx.hold ? <Text style={styles.note}>в обработке</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: color.glass.row,
  },
  first: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.md },
  last: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: space.md },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    backgroundColor: color.surface.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  left: { flex: 1 },
  right: { alignItems: "flex-end" },
  title: { ...type.body, color: color.fg.default },
  amount: { ...type.body, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  ask: { ...type.label, color: color.fg.default },
});
