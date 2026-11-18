import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { useInsights } from "../api/queries";
import { usePullRefresh } from "../usePullRefresh";
import { formatMoney, inMonth, kyivDate, monthTitle, pluralIndex } from "../format";
import { categoryLabel } from "../labels";
import { ErrorText } from "../components/ErrorText";
import { Glass } from "../components/Glass";
import { LAYOUT } from "../components/layout";
import { PlacesCard } from "../components/PlacesCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { SubscriptionsCard } from "../components/SubscriptionsCard";

const { color, radius, space, touchMin, type } = tokens;

type Category = InsightsMonthDto["categories"][number];

/** Rows shown before the rest folds into one «Ещё» row. */
const TOP = 5;

/** "2026-11" and a number of months later. */
function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const lastDayOf = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const monthNumber = (month: string): number => Number(month.slice(5, 7));
const dayNumber = (iso: string): number => Number(iso.slice(8, 10));

/** «Ноябрь, 1–16» while the month runs, «Октябрь» once it is whole; the year only when it is not this one. */
function subtitle(month: string, through: string | null, thisYear: string): string {
  const name = monthTitle(Number(month.slice(0, 4)), monthNumber(month));
  const titled = month.slice(0, 4) === thisYear ? name.replace(/ \d{4}$/, "") : name;
  if (!through || dayNumber(through) === lastDayOf(month)) return titled;
  return dayNumber(through) === 1 ? `${titled}, 1` : `${titled}, 1–${dayNumber(through)}`;
}

/** «потрачено · в октябре за те же дни ₴17,900», or «в сентябре» when the month before is counted whole. */
function comparison(d: InsightsMonthDto): string {
  if (d.previousSpent === 0) return "потрачено";
  const before = d.previous.from.slice(0, 7);
  const whole = dayNumber(d.previous.to) === lastDayOf(before);
  return `потрачено · в ${inMonth(monthNumber(before))}${whole ? "" : " за те же дни"} ${formatMoney(d.previousSpent)}`;
}

const categoriesText = (n: number): string => `${n} ${["категория", "категории", "категорий"][pluralIndex(n)]}`;

type Props = {
  /** Test seam for the current moment. */
  now?: () => Date;
  /** Leads to the operations of a category over the shown days of its month. */
  onOpenCategory?: (category: string, from: string, to: string) => void;
};

/**
 * «Итоги» (task В2): what the month's spending went on, category by category, each with a bright bar for this
 * month and a pale one for the same days of the month before. Earlier months are a step back with the arrows.
 */
export function Insights({ now = () => new Date(), onOpenCategory }: Props) {
  const insets = useSafeAreaInsets();
  const today = kyivDate(now());
  const thisMonth = today.slice(0, 7);
  // Months back from the current one; the current one is asked for without a month, as the server counts it.
  const [back, setBack] = useState(0);
  const [unfolded, setUnfolded] = useState(false);
  const asked = back === 0 ? undefined : shiftMonth(thisMonth, -back);
  const query = useInsights(asked);
  const pull = usePullRefresh(query.refetch);
  const data = query.data;
  const go = (by: number) => {
    setUnfolded(false);
    setBack(Math.max(0, back - by));
  };

  const head = (
    <View style={styles.head}>
      <Text style={styles.title}>Итоги</Text>
      {data !== null && (
        <View style={styles.arrows}>
          <Arrow label="Предыдущий месяц" text="‹" onPress={() => go(-1)} />
          <Arrow label="Следующий месяц" text="›" disabled={back === 0} onPress={() => go(1)} />
        </View>
      )}
    </View>
  );

  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: LAYOUT.tabBar + insets.bottom }]}
      refreshControl={<RefreshControl {...pull} />}
    >
      {head}
      {data === null ? (
        // An older server has no «Итоги» yet.
        <Text style={styles.quiet}>Итоги появятся после обновления сервера.</Text>
      ) : data ? (
        <Month data={data} past={back > 0} thisYear={today.slice(0, 4)} unfolded={unfolded} onUnfold={() => setUnfolded(true)} onOpenCategory={onOpenCategory} />
      ) : query.isError ? (
        <Glass style={styles.stack}>
          <ErrorText>Не получилось загрузить итоги. Проверьте связь и попробуйте ещё раз.</ErrorText>
          <PrimaryButton label="Повторить" onPress={() => void query.refetch()} />
        </Glass>
      ) : (
        <>
          <Text style={styles.subtitle}>{subtitle(asked ?? thisMonth, asked ? null : today, today.slice(0, 4))}</Text>
          <ActivityIndicator color={color.fg.muted} />
        </>
      )}
    </ScrollView>
  );
}

type MonthProps = {
  data: InsightsMonthDto;
  past: boolean;
  thisYear: string;
  unfolded: boolean;
  onUnfold: () => void;
  onOpenCategory?: (category: string, from: string, to: string) => void;
};

function Month({ data, past, thisYear, unfolded, onUnfold, onOpenCategory }: MonthProps) {
  // A category spent on only in the month before has nothing to show for this one.
  const rows = data.categories.filter((c) => c.count > 0 || c.spent !== 0);
  // One leftover row is shown as it is: «Ещё 1 категория» would take the same room.
  const folded = !unfolded && rows.length > TOP + 1;
  const shown = folded ? rows.slice(0, TOP) : rows;
  const rest = folded ? rows.slice(TOP) : [];
  // Bars are measured against the largest figure on the screen, of either month; nothing below zero.
  const largest = Math.max(0, ...rows.flatMap((c) => [c.spent, c.previousSpent]));
  const open = (c: Category) => onOpenCategory?.(c.category, `${data.month}-01`, data.through);

  return (
    <>
      <Text style={styles.subtitle}>{subtitle(data.month, data.through, thisYear)}</Text>
      <View>
        <Text style={styles.amount}>{formatMoney(data.spent)}</Text>
        <Text style={styles.note}>{comparison(data)}</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.quiet}>{past ? "Трат не было." : "Трат пока нет."}</Text>
      ) : (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Категории</Text>
          <Glass style={styles.card}>
            {shown.map((c, i) => (
              <Row key={c.category} c={c} largest={largest} first={i === 0} onPress={() => open(c)} />
            ))}
            {folded && <More rest={rest} onPress={onUnfold} />}
          </Glass>
        </View>
      )}
      {/* Task В2а: payments the limit leaves out (rent, taxes, debts), one quiet line with no breakdown. An older server does not send it. */}
      {(data.otherPayments ?? 0) > 0 && <Text style={styles.note}>{`Ещё платежи: ${formatMoney(data.otherPayments!)}`}</Text>}
      {/* Task В3: the month's largest places, under the categories; an older server does not send them. */}
      <PlacesCard places={data.places} />
      {/* Task В4, variant Б: one row with the total a month, opening the list; an older server does not send it. */}
      <SubscriptionsCard subscriptions={data.subscriptions} />
    </>
  );
}

function Row({ c, largest, first, onPress }: { c: Category; largest: number; first: boolean; onPress: () => void }) {
  const label = categoryLabel(c.category);
  const amount = formatMoney(c.spent);
  const width = (v: number) => `${(v / largest) * 100}%` as const;
  return (
    <Pressable testID="insights-row" accessibilityRole="button" accessibilityLabel={`${label}: ${amount}`} onPress={onPress} style={[styles.row, !first && styles.divided]}>
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>{label}</Text>
        <Text style={styles.sum}>{amount}</Text>
      </View>
      {/* The bars' room is kept when there is no bar, so the rows stay one height. */}
      <View style={styles.bars}>
        <View style={styles.barSlot}>
          {c.spent > 0 && <View testID={`bar-now-${c.category}`} style={[styles.barNow, { width: width(c.spent) }]} />}
        </View>
        <View style={styles.barSlotBefore}>
          {c.previousSpent > 0 && <View testID={`bar-before-${c.category}`} style={[styles.barBefore, { width: width(c.previousSpent) }]} />}
        </View>
      </View>
    </Pressable>
  );
}

function More({ rest, onPress }: { rest: Category[]; onPress: () => void }) {
  const text = `Ещё ${categoriesText(rest.length)}`;
  const sum = formatMoney(rest.reduce((s, c) => s + c.spent, 0));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}: ${sum}`} onPress={onPress} style={[styles.more, styles.divided]}>
      <Text style={styles.name}>{text}</Text>
      <View style={styles.moreRight}>
        <Text style={styles.moreSum}>{sum}</Text>
        <Text style={styles.moreSum}>›</Text>
      </View>
    </Pressable>
  );
}

function Arrow({ label, text, disabled = false, onPress }: { label: string; text: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.arrow}>
      <Text style={[styles.arrowText, disabled && styles.off]}>{text}</Text>
    </Pressable>
  );
}

const BAR = 4;
const BAR_BEFORE = 3;

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.md },
  // Lines up with the text inside the card below it.
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.lg },
  title: { ...type.title, color: color.fg.default },
  arrows: { flexDirection: "row" },
  arrow: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  arrowText: { ...type.title, color: color.fg.muted },
  off: { opacity: 0.3 },
  subtitle: { ...type.caption, color: color.fg.muted, paddingHorizontal: space.lg, marginTop: -space.md },
  amount: { ...type.display, color: color.fg.default, fontVariant: ["tabular-nums"], paddingHorizontal: space.lg },
  note: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"], paddingHorizontal: space.lg },
  quiet: { ...type.body, color: color.fg.muted, paddingHorizontal: space.lg },
  section: { gap: space.sm, marginTop: space.sm },
  eyebrow: { ...type.label, color: color.fg.subtle, paddingHorizontal: space.lg },
  card: { paddingVertical: 0 },
  row: { minHeight: touchMin, paddingVertical: space.md, gap: space.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  sum: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  bars: { gap: BAR_BEFORE },
  barSlot: { height: BAR },
  barSlotBefore: { height: BAR_BEFORE },
  barNow: { height: BAR, borderRadius: radius.full, backgroundColor: color.accent.signal },
  barBefore: { height: BAR_BEFORE, borderRadius: radius.full, backgroundColor: color.data.track },
  more: { minHeight: touchMin, paddingVertical: space.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  moreRight: { flexDirection: "row", gap: space.xs },
  moreSum: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  stack: { gap: space.md },
});
