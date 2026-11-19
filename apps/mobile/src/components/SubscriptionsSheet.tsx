import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { dayMonthLong, formatMoney, inMonth, pluralIndex } from "../format";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

export type Subscriptions = NonNullable<InsightsMonthDto["subscriptions"]>;
type Item = Subscriptions["items"][number];

/** «1 подписка», «3 подписки», «6 подписок». */
export const subscriptionsText = (n: number): string => `${n} ${["подписка", "подписки", "подписок"][pluralIndex(n)]}`;

/** «месяц», «2 месяца», «5 месяцев»: how long a subscription has not been charged. */
const monthsText = (n: number): string => (n === 1 ? "месяц" : `${n} ${["месяц", "месяца", "месяцев"][pluralIndex(n)]}`);

export const isActive = (i: Item): boolean => i.missed === 0;

/** The one quiet note under the row on «Итоги»: the first raised one, else the first not charged for a while, else none. */
export function subscriptionsNote(items: Item[]): string | null {
  const raised = items.find((i) => isActive(i) && i.raisedBy > 0);
  if (raised) return `${raised.name} подорожала на ${formatMoney(raised.raisedBy)}`;
  const missed = items.find((i) => !isActive(i));
  if (missed) return `${missed.name} не списывалась ${monthsText(missed.missed)}`;
  return null;
}

export const monthlyText = (s: Subscriptions): string => `${formatMoney(s.monthly)} в месяц`;

/**
 * The subscriptions found (task В4, variant Б): the ones still charged with their latest sums, then apart the ones
 * not charged for a while, which the total a month leaves out. Notes are grey: a change is news, not an alarm.
 * Opened from the phrase of the day's observation (В7), it ends with a quiet «Не показывать такое» (`onDismiss`).
 */
export function SubscriptionsSheet({ subscriptions, onClose, onDismiss }: { subscriptions: Subscriptions; onClose: () => void; onDismiss?: () => void }) {
  const active = subscriptions.items.filter(isActive);
  const missed = subscriptions.items.filter((i) => !isActive(i));
  return (
    <Sheet title="Подписки" subtitle={`${monthlyText(subscriptions)} · ${subscriptionsText(active.length)}`} onClose={onClose}>
      {active.length > 0 && (
        <View style={styles.card}>
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
          <View style={styles.card}>
            {missed.map((i, n) => (
              <ItemRow
                key={`${i.key}-${i.lastDate}`}
                testID="subscription-missed-row"
                item={i}
                note={`последний раз ${dayMonthLong(i.lastDate)}`}
                quiet
                first={n === 0}
              />
            ))}
          </View>
        </View>
      )}
      <Text style={styles.footer}>Нашли по повторам: тот же магазин, близкая сумма, примерно раз в месяц.</Text>
      {onDismiss && (
        <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>Не показывать такое</Text>
        </Pressable>
      )}
    </Sheet>
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
