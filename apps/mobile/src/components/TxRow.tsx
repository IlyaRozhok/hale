import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { amountTone, formatDollars, formatOriginal, formatSignedMoney, formatSignedOriginal } from "../format";
import { categoryName, type CategoryList, typeLabel } from "../labels";
import { categoryIcon } from "../categoryIcon";
import { Icon } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

type Props = {
  tx: TransactionDto;
  onPress: () => void;
  first: boolean;
  last: boolean;
  /** Under «Траты»: a row the limit does not count gets a quiet note. An older server says nothing, so nothing is shown. */
  markOutsideLimit?: boolean;
  /** The server's categories (В5) for the name and the badge; without them the built-in ones. */
  categories?: CategoryList;
};

// One accent: money in is green, everything else plain.
const TONES = { expense: color.money.neutral, income: color.accent.signal, neutral: color.money.neutral };
const BADGE = 36;

/** One operation: hryvnias first, the original currency noted. No money is calculated here. */
export function TxRow({ tx, onPress, first, last, markOutsideLimit = false, categories }: Props) {
  const foreign = tx.currency !== "UAH";
  const main = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  const title = tx.counterName ?? tx.description;
  // USDC exchanged for cash (task Б22): the dollars and the rate under the title, «свои» under the amount.
  const exchange = tx.exchange ? `${formatDollars(tx.exchange.usdc)} · курс ₴${tx.exchange.rate.toFixed(2)}` : null;
  const kind = exchange ?? tx.paymentName ?? (tx.type === "spend" ? categoryName(tx.category, categories) : typeLabel(tx.type));
  const tone = amountTone(tx.type, tx.amount);
  const icon = categoryIcon(tx, categories);
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
        {markOutsideLimit && tx.inLimit === false ? <Text style={styles.outside}>не из лимита</Text> : null}
        {tx.needsLabel ? <Text style={styles.ask}>Ждёт ответа</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: TONES[tone] }]}>{main}</Text>
        {foreign && tx.amountUah !== null ? <Text style={styles.note}>{formatOriginal(tx.amount, tx.currency)}</Text> : null}
        {foreign && tx.amountUah === null ? <Text style={styles.note}>курс неизвестен</Text> : null}
        {tx.hold ? <Text style={styles.note}>в обработке</Text> : null}
        {exchange ? <Text style={styles.note}>свои</Text> : null}
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
  outside: { ...type.caption, color: color.fg.muted },
  ask: { ...type.label, color: color.fg.default },
});
