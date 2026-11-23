import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney, inMonth, pluralIndex, shortDate } from "../format";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

export type Subscriptions = NonNullable<InsightsMonthDto["subscriptions"]>;
type Item = Subscriptions["items"][number];

/** «1 подписка», «3 подписки», «6 подписок». */
export const subscriptionsText = (n: number): string => `${n} ${["подписка", "подписки", "подписок"][pluralIndex(n)]}`;

export const isActive = (i: Item): boolean => i.missed === 0;

/** «₴1,886 в месяц · 6 подписок»: the total a month and how many are still charged. */
export const subscriptionsSummary = (s: Subscriptions): string =>
  `${formatMoney(s.monthly)} в месяц · ${subscriptionsText(s.items.filter(isActive).length)}`;

/**
 * The subscriptions found (task В4, variant Б): the ones still charged with their latest sums, then apart the ones
 * not charged for a while, which the total a month leaves out. Notes are grey: a change is news, not an alarm.
 * Opened from the phrase of the day's observation (В7), it ends with a quiet «Не показывать такое» (`onDismiss`).
 */
export function SubscriptionsSheet({ subscriptions, onClose, onDismiss }: { subscriptions: Subscriptions; onClose: () => void; onDismiss?: () => void }) {
  return (
    <Sheet title="Подписки" subtitle={subscriptionsSummary(subscriptions)} onClose={onClose}>
      <SubscriptionsList subscriptions={subscriptions} />
      {onDismiss && (
        <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>Не показывать такое</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

/**
 * The list itself: in the sheet, and on «Итоги» under «Подписки» (the screen's variant А). The ones still charged,
 * then apart the ones not charged for a while, then how they were found. The rows lead nowhere yet.
 */
export function SubscriptionsList({ subscriptions }: { subscriptions: Subscriptions }) {
  const active = subscriptions.items.filter(isActive);
  const missed = subscriptions.items.filter((i) => !isActive(i));
  return (
    <>
      {active.length > 0 && (
        <View testID="subscriptions-active-card" style={styles.card}>
          {active.map((i, n) => (
            <ItemRow
              key={`${i.key}-${i.lastDate}`}
              testID="subscription-row"
              item={i}
              note={i.raisedBy > 0 ? `подорожала на ${formatMoney(i.raisedBy)} в ${inMonth(Number(i.lastDate.slice(5, 7)))}` : null}
              first={n === 0}
            />
          ))}
        </View>
      )}
      {missed.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Давно не списывались</Text>
          <View testID="subscriptions-missed-card" style={styles.card}>
            {missed.map((i, n) => (
              <ItemRow
                key={`${i.key}-${i.lastDate}`}
                testID="subscription-missed-row"
                item={i}
                note={`последний раз ${shortDate(i.lastDate)}`}
                quiet
                first={n === 0}
              />
            ))}
          </View>
        </View>
      )}
      <Text style={styles.footer}>Нашли по повторам: тот же магазин, близкая сумма, примерно раз в месяц.</Text>
    </>
  );
}

type RowProps = { testID: string; item: Item; note: string | null; quiet?: boolean; first: boolean };

function ItemRow({ testID, item, note, quiet = false, first }: RowProps) {
  const amount = formatMoney(item.amount);
  return (
    <View testID={testID} accessible accessibilityLabel={`${item.name}: ${amount}${note ? `, ${note}` : ""}`} style={[styles.row, !first && styles.divided]}>
      <View style={styles.line}>
        <Text style={[styles.name, quiet && styles.quiet]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.sum, quiet && styles.quiet]}>{amount}</Text>
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  eyebrow: { ...type.label, color: color.fg.subtle },
  card: {
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  row: { minHeight: touchMin, paddingVertical: space.md, justifyContent: "center", gap: space.xs },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  sum: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  quiet: { color: color.fg.muted },
  note: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  footer: { ...type.caption, color: color.fg.subtle },
  dismiss: { minHeight: touchMin, justifyContent: "center", alignSelf: "flex-start" },
  dismissText: { ...type.label, color: color.fg.muted },
});
