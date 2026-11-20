import type { OwnMoneyItemDto, TodayDto } from "@hale/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { formatDollars, formatMoney, formatOriginal } from "../format";
import { placeName, placeOpens, wholeShares } from "../ownMoney";
import { Line } from "./Line";

const { color, space, touchMin, type } = tokens;

type Props = { accounts: TodayDto["accounts"] };

/**
 * What an older server sends: own money and credit money as separate lines (credit is a limit, not a
 * balance to add up). Cash and Binance have their own rows next to these.
 */
export function AccountLines({ accounts }: Props) {
  return (
    <>
      <Line label="Свои" kopecks={accounts.own} />
      {accounts.fop !== 0 && <Line subtle label="в том числе ФОП" kopecks={accounts.fop} />}
      <Line label="Кредитные" kopecks={accounts.credit} />
    </>
  );
}

/** A quiet line under a place: what a card in credit stands for, or a hand-kept balance in its own currency. */
function caption(item: OwnMoneyItemDto): string | null {
  if (item.own < 0 && item.creditLimit) {
    return item.own <= -item.creditLimit ? "кредитный лимит потрачен весь" : `потрачено из кредитного лимита ${formatMoney(item.creditLimit)}`;
  }
  if (item.amount !== undefined && item.currency && item.currency !== "UAH") {
    return item.currency === "USD" ? formatDollars(item.amount) : formatOriginal(item.amount, item.currency);
  }
  return null;
}

type MoneyProps = {
  own: number;
  items: OwnMoneyItemDto[];
  onCash: () => void;
  onBinance: () => void;
  /** Opens the account window of a bank account or a balance kept by hand, with its amount as the row shows it. */
  onAccount: (item: OwnMoneyItemDto, amount: string) => void;
};

/**
 * Own money as one figure, then the places it lies, which add up to it exactly (task Б25). A card in
 * credit goes last, with its minus and a word on its limit; cash and Binance open their windows, and on a newer
 * server every other place opens the account window (Д2б).
 */
export function OwnMoney({ own, items, onCash, onBinance, onAccount }: MoneyProps) {
  const ordered = [...items.filter((i) => i.own >= 0), ...items.filter((i) => i.own < 0)];
  // Rounded together, not one by one, so the rows add up to the figure above them to the hryvnia.
  const whole = wholeShares(own, ordered.map((i) => i.own));
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.total}>{formatMoney(own)}</Text>
        <Text style={styles.caption}>свои деньги — сумма строк ниже</Text>
      </View>
      {ordered.map((item, i) => {
        const amount = formatMoney(whole[i]! * 100);
        const opens = placeOpens(item);
        const press =
          opens === "cash" ? onCash : opens === "binance" ? onBinance : opens === null ? undefined : () => onAccount(item, amount);
        return <Place key={`${item.kind}:${item.id ?? i}`} label={placeName(item)} item={item} amount={amount} onPress={press} />;
      })}
    </>
  );
}

function Place({ label, item, amount, onPress }: { label: string; item: OwnMoneyItemDto; amount: string; onPress?: () => void }) {
  const note = caption(item);
  const body = (
    <>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {note ? <Text style={styles.caption}>{note}</Text> : null}
      </View>
      <Text style={styles.amount}>{amount}</Text>
      {onPress ? <Text style={styles.arrow}>›</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={note ? `${amount}, ${note}` : amount}
      onPress={onPress}
      style={styles.row}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { paddingVertical: space.sm },
  total: { ...type.display, color: color.fg.default, fontVariant: ["tabular-nums"] },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  text: { flex: 1 },
  label: { ...type.body, color: color.fg.default },
  caption: { ...type.caption, color: color.fg.muted },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  arrow: { ...type.title, color: color.fg.subtle },
});
