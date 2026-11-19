import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { useCategoryList, useDismissObservation, useObservation, useTransactions } from "../api/queries";
import { usePullRefresh } from "../usePullRefresh";
import { dayHeader, formatSignedMoney, kyivDate, operationsText, periodLabel } from "../format";
import { categoryLabel, categoryName } from "../labels";
import { observationText } from "../dayPhrase";
import { FiltersSheet, type Filters, type Period } from "../components/FiltersSheet";
import { ErrorText } from "../components/ErrorText";
import { Field } from "../components/Field";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { CashOperationSheet } from "../components/CashOperationSheet";
import { TxEditSheet } from "../components/TxEditSheet";
import { TxRow } from "../components/TxRow";

const { color, radius, space, touchMin, type } = tokens;

type Tab = "spend" | "income" | "all";

// Questions live in the bell on Today, one card per person; the list is only for looking.
const TABS: { tab: Tab; label: string; empty: string }[] = [
  { tab: "spend", label: "Траты", empty: "Трат пока нет." },
  { tab: "income", label: "Доходы", empty: "Доходов пока нет." },
  { tab: "all", label: "Все", empty: "Операций пока нет." },
];

const SEARCH_DELAY_MS = 300;

/** A row an answer can be about: already answered, or still a plain transfer out. */
const isTransferToSomeone = (t: TransactionDto) => t.amount < 0 && (t.recipientLabel !== null || t.type === "person_transfer");

/**
 * What a move to the operations may carry: `day` asks for that one day's spending (the limit calendar);
 * `category` with `from`..`to` for that category's spending over those days («Итоги», task В2); with `observation`
 * they came from the phrase of the day's observation (task В7), which is said again above the list. `at` differs on
 * every arrival, so the same one twice in a row is applied twice.
 */
export type ActivityParams = { day?: string; category?: string; from?: string; to?: string; at?: number; observation?: boolean } | undefined;

type Props = {
  /** Test seam for the current moment. */
  now?: () => Date;
  /** From the navigator; tests pass only `params`. */
  route?: Pick<RouteProp<{ Activity: ActivityParams }, "Activity">, "params">;
};

/** The operations list by day, newest first, pages by cursor. Transfers between own accounts only show under "Все". */
export function Activity({ now = () => new Date(), route }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("spend");
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TransactionDto | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [filtering, setFiltering] = useState(false);
  // Arrived from the phrase of the day's observation (В7): the card above the list stays until the filters change.
  const [fromObservation, setFromObservation] = useState(false);
  // Once asked for here, today's observation keeps being watched, so a dismissal is followed by the new answer.
  const [watchObservation, setWatchObservation] = useState(false);
  // A row waiting for an answer opens the label sheet; "Изменить тип" there switches to the full editor,
  // and the editor of an answered transfer leads back to the label sheet, to change the answer.
  const [sheet, setSheet] = useState<"edit" | "answer" | null>(null);
  const close = () => {
    setOpen(null);
    setSheet(null);
  };
  const showAnswer = open !== null && !open.manual && (sheet === "answer" || (sheet === null && open.needsLabel));

  useEffect(() => {
    const id = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [text]);

  // Arriving from a day of the limit calendar, or from a category of «Итоги»: that spending, and nothing
  // chosen before it. Done while rendering, so the list is never asked for with the old filters first.
  const params = route?.params;
  const target: Filters | null = params?.day
    ? { category: null, period: { from: params.day, to: params.day } }
    : params?.category && params.from && params.to
      ? { category: params.category, period: { from: params.from, to: params.to } }
      : null;
  const arrival = target ? `${target.category ?? ""}:${target.period?.from}..${target.period?.to}@${params?.at ?? 0}` : null;
  const [applied, setApplied] = useState<string | null>(null);
  if (target && arrival !== applied) {
    setApplied(arrival);
    setTab("spend");
    setCategory(target.category);
    setPeriod(target.period);
    setSearching(false);
    setText("");
    setSearch("");
    setFiltering(false);
    setOpen(null);
    setSheet(null);
    setFromObservation(params?.observation === true && target.category !== null);
    if (params?.observation === true) setWatchObservation(true);
  }

  const toggleSearch = () => {
    if (searching) {
      setText("");
      setSearch("");
    }
    setSearching(!searching);
  };

  // Income has no spending categories. Under "Все" a chosen one keeps narrowing the list, in sight
  // on the button and in the summary, until it is taken off in the window.
  const withCategories = tab !== "income";
  const chosenCategory = withCategories ? category : null;
  const list = useTransactions({
    group: tab,
    ...(chosenCategory ? { category: chosenCategory } : {}),
    ...(period ? { from: period.from, to: period.to } : {}),
    ...(search ? { q: search } : {}),
  });
  const pull = usePullRefresh(list.refetch);
  const categories = useCategoryList();
  const observation = useObservation(watchObservation);
  const dismissObservation = useDismissObservation();
  // An own category chosen and deleted since (В5): its operations are in «Без категории» now, so the filter is taken
  // off rather than left showing an empty list under the category's key. Keys this app names itself stay: the
  // type-level ones «Итоги» files rows under (transfer, cash, tax, …) are never in the server's list.
  useEffect(() => {
    const ownGone = category !== null && categoryLabel(category) === category && categories && !categories.some((c) => c.key === category);
    if (ownGone) setCategory(null);
  }, [categories, category]);
  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const totals = Object.assign({}, ...pages.map((p) => p.dayTotals)) as Record<string, number | undefined>;
  const today = kyivDate(now());
  const sections = items.reduce<{ date: string; data: TransactionDto[] }[]>((acc, tx) => {
    const lastSection = acc[acc.length - 1];
    if (lastSection?.date === tx.localDate) lastSection.data.push(tx);
    else acc.push({ date: tx.localDate, data: [tx] });
    return acc;
  }, []);
  const filtered = chosenCategory !== null || period !== null;
  const activeFilters = (chosenCategory !== null ? 1 : 0) + (period !== null ? 1 : 0);
  const emptyText = search || filtered ? "Ничего не нашлось." : TABS.find((t) => t.tab === tab)!.empty;
  const summary = pages[0]?.summary ?? null;
  // Said only while the list is still the observation's: its category over its days.
  const seen = observation.data;
  const noticed =
    fromObservation && seen?.kind === "spike" && seen.category === chosenCategory && period?.from === seen.from && period?.to === seen.to
      ? observationText(seen, categories, today)
      : null;
  const noticedCategory = noticed !== null ? (seen?.category ?? null) : null;
  const summaryTitle = [chosenCategory ? categoryName(chosenCategory, categories) : null, period ? periodLabel(period.from, period.to) : null].filter(Boolean).join(" · ");

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Операции</Text>
        <View style={styles.headButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Поиск" accessibilityState={{ expanded: searching }} onPress={toggleSearch} style={styles.searchButton}>
            <Icon name={searching ? "close" : "search"} color={color.fg.muted} size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeFilters > 0 ? `Фильтры: ${activeFilters}` : "Фильтры"}
            onPress={() => setFiltering(true)}
            style={styles.searchButton}
          >
            <Icon name="filter" color={activeFilters > 0 ? color.fg.default : color.fg.muted} size={20} />
            {activeFilters > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeFilters}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      {searching && <Field label="Поиск по операциям" value={text} onChangeText={setText} maxLength={100} autoFocus returnKeyType="search" />}
      <View testID="kind-switch" style={styles.segment}>
        {TABS.map((t) => (
          <Pressable
            key={t.tab}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.tab }}
            onPress={() => setTab(t.tab)}
            style={[styles.segmentItem, tab === t.tab && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, tab === t.tab && styles.segmentTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {filtered && summary && (
        <Text style={styles.summary}>{`${summaryTitle}: ${formatSignedMoney(summary.total)} · ${operationsText(summary.count)}`}</Text>
      )}
      {list.isError && items.length === 0 ? (
        <Glass style={styles.stack}>
          <ErrorText>Не получилось загрузить операции. Проверьте связь и попробуйте ещё раз.</ErrorText>
          <Pressable accessibilityRole="button" onPress={() => void list.refetch()} style={styles.button}>
            <Text style={styles.buttonText}>Повторить</Text>
          </Pressable>
        </Glass>
      ) : (
        <SectionList
          testID="activity-list"
          // Edge to edge, so the scroll bar runs along the screen's edge, not over the amounts.
          style={styles.list}
          sections={sections}
          keyExtractor={(t) => String(t.id)}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => {
            const total = totals[section.date];
            return (
              <View style={styles.day}>
                <Text style={styles.dayText}>{dayHeader(section.date, today)}</Text>
                {total !== undefined ? <Text style={styles.dayText}>{formatSignedMoney(total)}</Text> : null}
              </View>
            );
          }}
          renderItem={({ item, index, section }) => (
            <TxRow
              tx={item}
              onPress={() => setOpen(item)}
              first={index === 0}
              last={index === section.data.length - 1}
              // Under «Траты» the day total is what the limit counted (the server's figure, see dayTotals in
              // the contract); the rows it left out say so, so the list still adds up to its heading.
              markOutsideLimit={tab === "spend"}
              categories={categories}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: LAYOUT.tabBar + insets.bottom }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          ListHeaderComponent={
            noticed && noticedCategory ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{noticed}</Text>
                <Text style={styles.noticeCaption}>Обычно — середина трёх прошлых месяцев за те же дни</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setFromObservation(false);
                    // A refusal or no connection: the card comes back, so it can be pressed again.
                    dismissObservation.mutate({ kind: "spike", category: noticedCategory }, { onError: () => setFromObservation(true) });
                  }}
                  style={styles.noticeButton}
                >
                  <Text style={styles.noticeButtonText}>Не показывать такое</Text>
                </Pressable>
              </View>
            ) : undefined
          }
          ListEmptyComponent={list.isPending ? <ActivityIndicator color={color.fg.muted} /> : <Text style={styles.muted}>{emptyText}</Text>}
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={color.fg.muted} style={styles.footer} /> : undefined}
        />
      )}
      {open && showAnswer && (
        <RecipientLabelSheet
          counterKey={open.counterKey}
          name={open.counterName ?? open.description}
          onClose={close}
          onEditType={() => setSheet("edit")}
        />
      )}
      {open?.manual && <CashOperationSheet tx={open} onClose={close} />}
      {filtering && (
        <FiltersSheet
          today={kyivDate(now())}
          // The remembered category, also under "Доходы": the window does not show it there, and hands it back untouched.
          value={{ period, category }}
          withCategories={withCategories}
          onApply={(f) => {
            setPeriod(f.period);
            setCategory(f.category);
            setFromObservation(false);
          }}
          onClose={() => setFiltering(false)}
        />
      )}
      {open && !open.manual && !showAnswer && (
        <TxEditSheet tx={open} onClose={close} onAnswer={isTransferToSomeone(open) ? () => setSheet("answer") : undefined} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  // A solid card, not glass: the observation is text to read, not a floating control.
  notice: {
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.xs,
    borderRadius: radius.xl,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  noticeText: { ...type.body, color: color.fg.default },
  noticeCaption: { ...type.caption, color: color.fg.muted },
  noticeButton: { minHeight: touchMin, justifyContent: "center", alignSelf: "flex-start" },
  noticeButtonText: { ...type.label, color: color.fg.muted },
  headButtons: { flexDirection: "row", gap: space.xs },
  badge: {
    position: "absolute",
    top: space.xs,
    right: space.xs,
    minWidth: space.lg,
    height: space.lg,
    borderRadius: radius.full,
    backgroundColor: color.accent.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...type.caption, fontWeight: "500", color: color.accent.fgOnSignal },
  segment: { flexDirection: "row", padding: space.xs, borderRadius: radius.lg, backgroundColor: color.card.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: color.card.edge },
  segmentItem: { flex: 1, minHeight: touchMin - space.sm, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  segmentOn: { backgroundColor: color.surface.overlay },
  segmentText: { ...type.label, color: color.fg.muted },
  segmentTextOn: { color: color.fg.default },
  root: { flex: 1, paddingHorizontal: space.xl, gap: space.md },
  list: { marginHorizontal: -space.xl },
  title: { ...type.title, color: color.fg.default },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  searchButton: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  day: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingTop: space.lg, paddingBottom: space.sm },
  dayText: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  stack: { gap: space.md },
  muted: { ...type.body, color: color.fg.muted },
  footer: { paddingVertical: space.lg },
  button: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  buttonText: { ...type.label, color: color.accent.fgOnAccent },
});
