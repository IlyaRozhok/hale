import type { OwnMoneyItemDto, TodayDto } from "@hale/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { formatDollars, formatMoney, formatOriginal } from "../format";
import { accountLabel } from "../labels";
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
    return item.own <= -item.creditLimit ? "кредитный лимит потрачен весь" : `из кредитного лимита ${formatMoney(item.creditLimit)}`;
  }
  if (item.amount !== undefined && item.currency && item.currency !== "UAH") {
    return item.currency === "USD" ? formatDollars(item.amount) : formatOriginal(item.amount, item.currency);
  }
  return null;
}

type MoneyProps = { own: number; items: OwnMoneyItemDto[]; onCash: () => void; onBinance: () => void };

/**
 * Own money as one figure, then the places it lies, which add up to it exactly (task Б25). A card in
 * credit goes last, with its minus and a word on its limit; cash and Binance open their windows.
 */
export function OwnMoney({ own, items, onCash, onBinance }: MoneyProps) {
  const ordered = [...items.filter((i) => i.own >= 0), ...items.filter((i) => i.own < 0)];
  return (
    <>
      <View style={styles.head}>
        <Text style={styles.total}>{formatMoney(own)}</Text>
        <Text style={styles.caption}>свои деньги — сумма строк ниже</Text>
      </View>
      {ordered.map((item, i) => {
        const press = item.kind === "cash" ? onCash : item.kind === "binance" ? onBinance : undefined;
        return <Place key={`${item.kind}:${i}`} label={accountLabel(item.kind) ?? item.name} item={item} onPress={press} />;
      })}
    </>
  );
}

function Place({ label, item, onPress }: { label: string; item: OwnMoneyItemDto; onPress?: () => void }) {
  const note = caption(item);
  const amount = formatMoney(item.own);
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
