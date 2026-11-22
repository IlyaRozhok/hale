import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { useCategoryList, useInsights } from "../api/queries";
import { usePullRefresh } from "../usePullRefresh";
import { formatMoney, inMonth, kyivDate, monthTitle } from "../format";
import { categoryName, type CategoryList } from "../labels";
import { categoryIconOf } from "../categoryIcon";
import { CategoriesSheet } from "../components/CategoriesSheet";
import { ErrorText } from "../components/ErrorText";
import { Glass } from "../components/Glass";
import { LAYOUT } from "../components/layout";
import { InsetList, ListRow } from "../components/ListRow";
import { PlacesCard } from "../components/PlacesCard";
import { PrimaryButton } from "../components/PrimaryButton";
import { Segmented } from "../components/Segmented";
import { isActive, SubscriptionsList, subscriptionsSummary } from "../components/SubscriptionsSheet";

const { color, radius, space, touchMin, type } = tokens;

type Category = InsightsMonthDto["categories"][number];
type Tab = "categories" | "places" | "subscriptions";

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

type Props = {
  /** Test seam for the current moment. */
  now?: () => Date;
  /** Leads to the operations of a category over the shown days of its month. */
  onOpenCategory?: (category: string, from: string, to: string) => void;
  /** Leads to the purchases of «желаемое» over the same days (task В6). */
  onOpenWanted?: (from: string, to: string) => void;
};

/**
 * «Итоги» (task В2), in the iOS manner of the mockup's variant А: a large title with «Править» in the corner, the
 * month under it with its arrows, the month's sum, then a switch «Категории · Места · Подписки» over one list.
 * Earlier months are a step back with the arrows.
 */
export function Insights({ now = () => new Date(), onOpenCategory, onOpenWanted }: Props) {
  const insets = useSafeAreaInsets();
  const today = kyivDate(now());
  const thisMonth = today.slice(0, 7);
  // Months back from the current one; the current one is asked for without a month, as the server counts it.
  const [back, setBack] = useState(0);
  const [tab, setTab] = useState<Tab>("categories");
  const [editing, setEditing] = useState(false);
  const asked = back === 0 ? undefined : shiftMonth(thisMonth, -back);
  const query = useInsights(asked);
  const list = useCategoryList();
  const pull = usePullRefresh(query.refetch);
  const data = query.data;
  const thisYear = today.slice(0, 4);
  const go = (by: number) => setBack(Math.max(0, back - by));

  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: LAYOUT.tabBar + insets.bottom }]}
      refreshControl={<RefreshControl {...pull} />}
    >
      {/* Task В5: the list of categories is changed from the corner, as in any iOS list; an older server keeps the built-in one. */}
      <View style={styles.top}>
        {list && data !== null && (
          <Pressable accessibilityRole="button" accessibilityLabel="Править" onPress={() => setEditing(true)} style={styles.edit}>
            <Text style={styles.editText}>Править</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.title}>Итоги</Text>
      {data !== null && (
        <View style={styles.monthLine}>
          <Arrow label="Предыдущий месяц" text="‹" onPress={() => go(-1)} />
          <Text style={styles.subtitle}>{data ? subtitle(data.month, data.through, thisYear) : subtitle(asked ?? thisMonth, asked ? null : today, thisYear)}</Text>
          <Arrow label="Следующий месяц" text="›" disabled={back === 0} onPress={() => go(1)} />
        </View>
      )}
      {data === null ? (
        // An older server has no «Итоги» yet.
        <Text style={styles.quiet}>Итоги появятся после обновления сервера.</Text>
      ) : data ? (
        <Month data={data} past={back > 0} list={list} tab={tab} onTab={setTab} onOpenCategory={onOpenCategory} onOpenWanted={onOpenWanted} />
      ) : query.isError ? (
        <Glass style={styles.stack}>
          <ErrorText>Не получилось загрузить итоги. Проверьте связь и попробуйте ещё раз.</ErrorText>
          <PrimaryButton label="Повторить" onPress={() => void query.refetch()} />
        </Glass>
      ) : (
        <ActivityIndicator color={color.fg.muted} />
      )}
      {editing && <CategoriesSheet onClose={() => setEditing(false)} />}
    </ScrollView>
  );
}

type MonthProps = {
  data: InsightsMonthDto;
  past: boolean;
  list: CategoryList;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onOpenCategory?: (category: string, from: string, to: string) => void;
  onOpenWanted?: (from: string, to: string) => void;
};

/**
 * Task В6, variant А: the part of «потрачено» that went on «желаемое». An older server does not send it; none is
 * nothing to say; more than all that was spent (refunds landing on «нужное») would read as nonsense, so no row.
 */
const wantedShown = (d: InsightsMonthDto): number | null =>
  d.wanted !== undefined && d.wanted > 0 && d.wanted <= d.spent ? d.wanted : null;

function Month({ data, past, list, tab, onTab, onOpenCategory, onOpenWanted }: MonthProps) {
  // A category spent on only in the month before has nothing to show for this one.
  const rows = data.categories.filter((c) => c.count > 0 || c.spent !== 0);
  // One bar per row: its share of this month's largest category; nothing below zero.
  const largest = Math.max(0, ...rows.map((c) => c.spent));
  const from = `${data.month}-01`;
  const open = (c: Category) => onOpenCategory?.(c.category, from, data.through);
  const wanted = wantedShown(data);
  // Task В2а: payments the limit leaves out (rent, taxes, debts). An older server does not send it.
  const other = (data.otherPayments ?? 0) > 0 ? data.otherPayments! : null;
  // Tasks В3 and В4: an older server sends neither; a segment with nothing in it is not offered.
  const places = data.places && data.places.length > 0 ? data.places : null;
  const subscriptions = data.subscriptions && data.subscriptions.items.some(isActive) ? data.subscriptions : null;
  const options: { key: Tab; label: string }[] = [
    { key: "categories", label: "Категории" },
    ...(places ? [{ key: "places" as const, label: "Места" }] : []),
    ...(subscriptions ? [{ key: "subscriptions" as const, label: "Подписки" }] : []),
  ];
  // A month without the chosen list shows the categories.
  const shown = options.some((o) => o.key === tab) ? tab : "categories";

  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.amount}>{formatMoney(data.spent)}</Text>
        <Text style={styles.note}>{comparison(data)}</Text>
      </View>
      {options.length > 1 && <Segmented options={options} value={shown} onChange={onTab} />}
      {shown === "places" && <PlacesCard places={places ?? undefined} />}
      {shown === "subscriptions" && subscriptions && (
        <View style={styles.stack}>
          <Text style={styles.summary}>{subscriptionsSummary(subscriptions)}</Text>
          <SubscriptionsList subscriptions={subscriptions} />
        </View>
      )}
      {shown === "categories" && (
        <>
          {rows.length === 0 ? (
            <Text style={styles.quiet}>{past ? "Трат не было." : "Трат пока нет."}</Text>
          ) : (
            <InsetList>
              {rows.map((c, i) => (
                <CategoryRow key={c.category} c={c} list={list} largest={largest} first={i === 0} onPress={() => open(c)} />
              ))}
            </InsetList>
          )}
          {(wanted !== null || other !== null) && (
            <InsetList>
              {wanted !== null && (
                <ListRow
                  testID="wanted-row"
                  icon="card"
                  title="Желаемое"
                  // Only the server's own figure: «нужное» is not sent, and spent − wanted would not be it exactly.
                  amount={formatMoney(wanted)}
                  accessibilityLabel={`Желаемое: ${formatMoney(wanted)}`}
                  first
                  onPress={() => onOpenWanted?.(from, data.through)}
                />
              )}
              {/* Not a button: «Операции» has no filter for these payments yet. */}
              {other !== null && (
                <ListRow
                  testID="other-payments-row"
                  icon="calendar"
                  title="Платежи вне лимита"
                  amount={formatMoney(other)}
                  accessibilityLabel={`Платежи вне лимита: ${formatMoney(other)}`}
                  first={wanted === null}
                />
              )}
            </InsetList>
          )}
        </>
      )}
    </>
  );
}

function CategoryRow({ c, list, largest, first, onPress }: { c: Category; list: CategoryList; largest: number; first: boolean; onPress: () => void }) {
  const label = categoryName(c.category, list);
  const amount = formatMoney(c.spent);
  return (
    <ListRow
      testID="insights-row"
      iconTestID={`insights-icon-${c.category}`}
      icon={categoryIconOf(c.category, list)}
      title={label}
      // The bar's room is kept when there is no bar, so the rows stay one height.
      below={
        <View style={styles.barSlot}>
          {c.spent > 0 && largest > 0 && <View testID={`bar-now-${c.category}`} style={[styles.bar, { width: `${(c.spent / largest) * 100}%` }]} />}
        </View>
      }
      amount={amount}
      accessibilityLabel={`${label}: ${amount}`}
      first={first}
      onPress={onPress}
    />
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, gap: space.md },
  top: { minHeight: touchMin, flexDirection: "row", justifyContent: "flex-end" },
  edit: { minHeight: touchMin, minWidth: touchMin, justifyContent: "center", alignItems: "flex-end", paddingHorizontal: space.xs },
  editText: { ...type.body, color: color.fg.default },
  title: { ...type.display, color: color.fg.default, paddingHorizontal: space.xs },
  // The arrows hug the month's name, as in «Экранное время».
  monthLine: { flexDirection: "row", alignItems: "center", marginTop: -space.md },
  // A full touch target; negative margins pull the glyph close to the month's name (and the first one to the edge).
  arrow: { minWidth: touchMin, minHeight: touchMin, marginHorizontal: -space.sm, alignItems: "center", justifyContent: "center" },
  arrowText: { ...type.body, color: color.fg.muted },
  off: { opacity: 0.3 },
  subtitle: { ...type.body, color: color.fg.muted },
  hero: { paddingHorizontal: space.xs },
  amount: { ...type.amount, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"] },
  summary: { ...type.label, color: color.fg.muted, fontVariant: ["tabular-nums"], paddingHorizontal: space.xs },
  quiet: { ...type.body, color: color.fg.muted, paddingHorizontal: space.xs },
  stack: { gap: space.md },
  barSlot: { height: BAR },
  bar: { height: BAR, borderRadius: radius.full, backgroundColor: color.accent.signal },
});
