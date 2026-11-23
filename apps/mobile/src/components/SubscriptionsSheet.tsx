import { type ReactNode, useRef, useState } from "react";
import { type AccessibilityActionEvent, Animated, type GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney, inMonth, pluralIndex, shortDate } from "../format";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

export type Subscriptions = NonNullable<InsightsMonthDto["subscriptions"]>;
type Item = Subscriptions["items"][number];

/** Leads to every operation of a subscription's place (task Я8): its counterparty key and its name. */
export type OpenPlace = (key: string, name: string) => void;

/** «Не подписка» (task ЯМ6): the place, by its key, is not a subscription. */
export type NotSubscription = (key: string) => void;

/** The width of the grey «Не подписка» behind a row, in points. */
export const NOT_SUBSCRIPTION_WIDTH = 120;

/**
 * Where a row swiped left to `x` (negative) comes to rest, in a row `width` points wide: past most of the row it is
 * a full swipe that marks at once; past half the button it stays open on the button; otherwise it goes back.
 */
export function swipeRest(x: number, width: number): "full" | "open" | "closed" {
  if (width > 0 && -x >= Math.max(width * 0.6, NOT_SUBSCRIPTION_WIDTH + 64)) return "full";
  if (-x >= NOT_SUBSCRIPTION_WIDTH / 2) return "open";
  return "closed";
}

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
 * With `onOpenPlace` a row closes the sheet and opens that place's operations (task Я8).
 */
export function SubscriptionsSheet({
  subscriptions,
  onClose,
  onDismiss,
  onOpenPlace,
}: {
  subscriptions: Subscriptions;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenPlace?: OpenPlace;
}) {
  const open: OpenPlace | undefined = onOpenPlace
    ? (key, name) => {
        onClose();
        onOpenPlace(key, name);
      }
    : undefined;
  return (
    <Sheet title="Подписки" subtitle={subscriptionsSummary(subscriptions)} onClose={onClose}>
      <SubscriptionsList subscriptions={subscriptions} onOpenPlace={open} />
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
 * then apart the ones not charged for a while, then how they were found. With `onOpenPlace` (only once the server takes
 * that filter) a row leads to its place's operations; two subscriptions at one place lead to the same list.
 * Several charged ones under one name (three «Apple») say the date of their last charge, so they can be told apart.
 * With `onNotSubscription` (task ЯМ6, only once the server remembers it) a row swiped left shows a grey «Не подписка»,
 * and VoiceOver has the same as the row's action.
 */
export function SubscriptionsList({
  subscriptions,
  onOpenPlace,
  onNotSubscription,
}: {
  subscriptions: Subscriptions;
  onOpenPlace?: OpenPlace;
  onNotSubscription?: NotSubscription;
}) {
  const active = subscriptions.items.filter(isActive);
  const missed = subscriptions.items.filter((i) => !isActive(i));
  const named = (name: string) => active.filter((i) => i.name === name).length;
  return (
    <>
      {active.length > 0 && (
        <View testID="subscriptions-active-card" style={styles.card}>
          {active.map((i, n) => (
            <ItemRow
              key={`${i.key}-${i.lastDate}`}
              testID="subscription-row"
              item={i}
              notes={[
                named(i.name) > 1 ? `последнее списание ${shortDate(i.lastDate)}` : null,
                i.raisedBy > 0 ? `подорожала на ${formatMoney(i.raisedBy)} в ${inMonth(Number(i.lastDate.slice(5, 7)))}` : null,
              ]}
              first={n === 0}
              onOpenPlace={onOpenPlace}
              onNotSubscription={onNotSubscription}
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
                notes={[`последний раз ${shortDate(i.lastDate)}`]}
                quiet
                first={n === 0}
                onOpenPlace={onOpenPlace}
                onNotSubscription={onNotSubscription}
              />
            ))}
          </View>
        </View>
      )}
      <Text style={styles.footer}>Нашли по повторам: тот же магазин, близкая сумма, примерно раз в месяц.</Text>
    </>
  );
}

type RowProps = {
  testID: string;
  item: Item;
  notes: (string | null)[];
  quiet?: boolean;
  first: boolean;
  onOpenPlace?: OpenPlace;
  onNotSubscription?: NotSubscription;
};

const NOT_SUBSCRIPTION_ACTION = [{ name: "notSubscription", label: "Не подписка" }];

function ItemRow({ testID, item, notes, quiet = false, first, onOpenPlace, onNotSubscription }: RowProps) {
  const amount = formatMoney(item.amount);
  const shown = notes.filter((n): n is string => n !== null);
  const label = [`${item.name}: ${amount}`, ...shown].join(", ");
  const body = (
    <>
      <View style={styles.line}>
        <Text style={[styles.name, quiet && styles.quiet]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.sum, quiet && styles.quiet]}>{amount}</Text>
        {onOpenPlace && (
          <View testID="row-chevron" style={styles.chevron}>
            <Icon name="chevron" color={color.list.chevron} size={16} />
          </View>
        )}
      </View>
      {shown.map((n) => (
        <Text key={n} style={styles.note}>{n}</Text>
      ))}
    </>
  );
  const style = [styles.row, !first && styles.divided];
  const mark = onNotSubscription ? () => onNotSubscription(item.key) : undefined;
  // VoiceOver: the swipe's button is hidden there, so the row itself has «Не подписка» among its actions.
  const actions = mark
    ? {
        accessibilityActions: NOT_SUBSCRIPTION_ACTION,
        onAccessibilityAction: (e: AccessibilityActionEvent) => {
          if (e.nativeEvent.actionName === "notSubscription") mark();
        },
      }
    : {};
  const row = onOpenPlace ? (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpenPlace(item.key, item.name)} style={style} {...actions}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID} accessible accessibilityLabel={label} style={style} {...actions}>
      {body}
    </View>
  );
  return mark ? <SwipeRow onMark={mark}>{row}</SwipeRow> : row;
}

/**
 * A row that slides left over a calm grey «Не подписка» (task ЯМ6), as «Архив» in Mail: not red, nothing is deleted.
 * A swipe past most of the row marks at once; a shorter one stays open on the button; a tap on an open row closes it.
 * Plain responder events, as in `Sheet`: the row takes the touch only once it moves sideways, so a tap still opens
 * the place and a move up or down still scrolls.
 */
function SwipeRow({ onMark, children }: { onMark: () => void; children: ReactNode }) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const start = useRef({ x: 0, y: 0, from: 0 });
  const rest = useRef(0);
  const [open, setOpen] = useState(false);

  const settle = (to: number) => {
    rest.current = to;
    setOpen(to !== 0);
    Animated.timing(x, { toValue: to, duration: 180, useNativeDriver: true }).start();
  };
  const sideways = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.pageX - start.current.x;
    const dy = e.nativeEvent.pageY - start.current.y;
    return Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5;
  };
  // Only to the left, and no further than the row is wide.
  const at = (e: GestureResponderEvent) => {
    const moved = start.current.from + e.nativeEvent.pageX - start.current.x;
    return Math.min(0, width.current > 0 ? Math.max(-width.current, moved) : moved);
  };
  const release = (e: GestureResponderEvent) => {
    // A tap on an open row closes it.
    if (start.current.from !== 0 && Math.abs(e.nativeEvent.pageX - start.current.x) <= 8) return settle(0);
    const to = swipeRest(at(e), width.current);
    if (to === "full") {
      // The row slides out; the list asked for again no longer has it.
      rest.current = 0;
      setOpen(false);
      Animated.timing(x, { toValue: -width.current, duration: 160, useNativeDriver: true }).start();
      onMark();
    } else settle(to === "open" ? -NOT_SUBSCRIPTION_WIDTH : 0);
  };

  return (
    <View style={styles.swipe}>
      <View style={styles.behind} accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
        <Pressable
          testID="not-subscription-button"
          accessibilityRole="button"
          accessibilityLabel="Не подписка"
          onPress={() => {
            settle(0);
            onMark();
          }}
          style={styles.notSubscription}
        >
          <Text style={styles.notSubscriptionText}>Не подписка</Text>
        </Pressable>
      </View>
      <Animated.View
        testID="subscription-swipe"
        style={[styles.front, { transform: [{ translateX: x }] }]}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
        onTouchStart={(e) => (start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, from: rest.current })}
        // An open row takes a tap itself and closes, so that tap does not also open the place.
        onStartShouldSetResponderCapture={() => rest.current !== 0}
        onMoveShouldSetResponderCapture={sideways}
        onResponderTerminationRequest={() => false}
        onResponderMove={(e) => x.setValue(at(e))}
        onResponderRelease={release}
        onResponderTerminate={() => settle(rest.current)}
      >
        {children}
      </Animated.View>
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
    // A row swiped left (ЯМ6) slides under the rounded edge, not past it.
    overflow: "hidden",
  },
  row: { minHeight: touchMin, paddingVertical: space.md, justifyContent: "center", gap: space.xs },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  sum: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  chevron: { alignSelf: "center" },
  quiet: { color: color.fg.muted },
  note: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  footer: { ...type.caption, color: color.fg.subtle },
  // The card's own padding moves onto the row, so the grey button reaches the card's edge.
  swipe: { marginHorizontal: -space.lg },
  behind: { ...(StyleSheet.absoluteFill as object), flexDirection: "row", justifyContent: "flex-end" },
  notSubscription: { width: NOT_SUBSCRIPTION_WIDTH, alignItems: "center", justifyContent: "center", backgroundColor: color.surface.overlay },
  notSubscriptionText: { ...type.label, color: color.fg.default },
  front: { paddingHorizontal: space.lg, backgroundColor: color.card.fill },
  dismiss: { minHeight: touchMin, justifyContent: "center", alignSelf: "flex-start" },
  dismissText: { ...type.label, color: color.fg.muted },
});
