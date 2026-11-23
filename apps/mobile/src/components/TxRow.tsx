import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { amountTone, cardTransferTitle, formatDollars, formatOriginal, formatSignedMoney, formatSignedOriginal } from "../format";
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
const ICON = 22;

/** One operation: hryvnias first, the original currency noted. No money is calculated here. */
export function TxRow({ tx, onPress, first, last, markOutsideLimit = false, categories }: Props) {
  const foreign = tx.currency !== "UAH";
  const main = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  const title = tx.counterName ?? cardTransferTitle(tx.description, tx.amount) ?? tx.description;
  // USDC exchanged for cash (task Б22): the dollars and the rate under the title, «свои» under the amount.
  const exchange = tx.exchange ? `${formatDollars(tx.exchange.usdc)} · курс ₴${tx.exchange.rate.toFixed(2)}` : null;
  const kind = exchange ?? tx.paymentName ?? (tx.type === "spend" ? categoryName(tx.category, categories) : typeLabel(tx.type));
  const tone = amountTone(tx.type, tx.amount);
  const icon = categoryIcon(tx, categories);
  const outside = markOutsideLimit && tx.inLimit === false;
  const original = foreign ? (tx.amountUah !== null ? formatOriginal(tx.amount, tx.currency) : "курс неизвестен") : null;
  // Still processed by the bank (ЯМ2): no caption on the row, only a quieter amount; the card says what it means.
  // VoiceOver hears it, so the row's label is everything it shows and «в обработке» after it. An older server
  // without the field: not held.
  const held = tx.hold === true;
  const label = held
    ? [title, kind, outside ? "не из лимита" : null, tx.needsLabel ? "Ждёт ответа" : null, main, original, exchange ? "свои" : null, "в обработке"]
        .filter((part) => part !== null)
        .join(", ")
    : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, first && styles.first, last && styles.last]}
    >
      <View testID={`tx-icon-${icon}`} style={styles.icon}>
        <Icon name={icon} color={tone === "income" ? color.accent.signal : color.list.icon} size={18} />
      </View>
      <View testID="tx-line" style={[styles.line, !first && styles.divided]}>
        <View style={styles.left}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.note}>{kind}</Text>
          {outside ? <Text style={styles.outside}>не из лимита</Text> : null}
          {tx.needsLabel ? <Text style={styles.ask}>Ждёт ответа</Text> : null}
        </View>
        <View style={styles.right}>
          <Text style={[styles.amount, { color: held ? color.fg.muted : TONES[tone] }]}>{main}</Text>
          {original !== null ? <Text style={styles.note}>{original}</Text> : null}
          {exchange ? <Text style={styles.note}>свои</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

// A day's operations are one solid card (no glass on a list); the hairline between them starts at the text.
const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "stretch",
    gap: space.md,
    paddingLeft: space.lg,
    backgroundColor: color.card.fill,
  },
  first: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingTop: space.xs },
  last: { borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card, paddingBottom: space.xs },
  icon: { width: ICON, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, paddingRight: space.lg },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  left: { flex: 1 },
  right: { alignItems: "flex-end" },
  title: { ...type.body, color: color.fg.default },
  amount: { ...type.body, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.list.secondary, fontVariant: ["tabular-nums"] },
  outside: { ...type.caption, color: color.fg.muted },
  ask: { ...type.label, color: color.fg.default },
});
