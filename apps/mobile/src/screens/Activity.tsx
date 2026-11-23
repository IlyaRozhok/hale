import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { tokens } from "@hale/tokens";
import type { AccountFilterKind, TransactionDto } from "@hale/contracts";
import { useCategoryList, useDismissObservation, useObservation, useTransactionFilters, useTransactions } from "../api/queries";
import { usePullRefresh } from "../usePullRefresh";
import { dayHeader, formatSignedMoney, kyivDate, operationsText, periodLabel } from "../format";
import { accountChoices, accountLabel, categoryLabel, categoryName, wantLabel } from "../labels";
import { observationText } from "../dayPhrase";
import { FiltersSheet, type Filters, type Period } from "../components/FiltersSheet";
import { ErrorText } from "../components/ErrorText";
import { Field } from "../components/Field";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { Segmented } from "../components/Segmented";
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

const TAB_OPTIONS = TABS.map((t) => ({ key: t.tab, label: t.label }));

const SEARCH_DELAY_MS = 300;

/** A row an answer can be about: already answered, or still a plain transfer out. */
const isTransferToSomeone = (t: TransactionDto) => t.amount < 0 && (t.recipientLabel !== null || t.type === "person_transfer");

/**
 * What a move to the operations may carry: `day` asks for that one day's spending (the limit calendar);
 * `category` with `from`..`to` for that category's spending over those days («Итоги», task В2); with `observation`
 * they came from the phrase of the day's observation (task В7), which is said again above the list; `want` with
 * `from`..`to` for the purchases of «желаемое» over those days (the row «Желаемое» of «Итоги», task В6); `other` with
 * `from`..`to` for the payments outside the limit over those days, `place` (with its name, `placeName`) for every
 * operation of one place (the row «Платежи вне лимита» and a subscription of «Итоги», task Я8). `at`
 * differs on every arrival, so the same one twice in a row is applied twice.
 */
export type ActivityParams =
  | {
      day?: string;
      category?: string;
      want?: boolean;
      other?: boolean;
      place?: string;
      placeName?: string;
      from?: string;
      to?: string;
      at?: number;
      observation?: boolean;
    }
  | undefined;

/** One place (Я8): its counterparty key, and its name as «Итоги» showed it, for the summary. */
type Place = { key: string; name: string };

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
  // Only the purchases «Итоги» count as «желаемое» (В6): set by arriving from there, taken off by «Сбросить».
  const [want, setWant] = useState(false);
  // The payments outside the limit, or one place (Я8): the same way, set by arriving from «Итоги», off with «Сбросить».
  // Asked for only once the server has named them: an older one refuses them.
  const [other, setOther] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  // One account (Д1), on every tab: offered only once the server has named the person's accounts.
  const [account, setAccount] = useState<AccountFilterKind | null>(null);
  // The last list of them the server named, kept while a page with new filters loads.
  const [accountKinds, setAccountKinds] = useState<AccountFilterKind[] | undefined>(undefined);
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
  const nothingElse = { category: null, want: false, other: false, place: null };
  const target: (Omit<Filters, "account"> & { want: boolean; other: boolean; place: Place | null }) | null = params?.day
    ? { ...nothingElse, period: { from: params.day, to: params.day } }
    : params?.category && params.from && params.to
      ? { ...nothingElse, category: params.category, period: { from: params.from, to: params.to } }
      : params?.want === true && params.from && params.to
        ? { ...nothingElse, want: true, period: { from: params.from, to: params.to } }
        : params?.other === true && params.from && params.to
          ? { ...nothingElse, other: true, period: { from: params.from, to: params.to } }
          : params?.place
            ? { ...nothingElse, place: { key: params.place, name: params.placeName ?? "" }, period: null }
            : null;
  const arrival = target
    ? `${target.category ?? ""}:${target.want ? "want" : ""}:${target.other ? "other" : ""}:${target.place?.key ?? ""}:${target.period?.from}..${target.period?.to}@${params?.at ?? 0}`
    : null;
  const [applied, setApplied] = useState<string | null>(null);
  if (target && arrival !== applied) {
    setApplied(arrival);
    setTab("spend");
    setCategory(target.category);
    setWant(target.want);
    setOther(target.other);
    setPlace(target.place);
    setAccount(null);
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

  const applyFilters = (f: Filters) => {
    setPeriod(f.period);
    setCategory(f.category);
    setAccount(f.account);
    // The window has no «желаемое», payments outside the limit or place of its own: «Сбросить» (nothing left chosen)
    // takes them off with the rest.
    if (f.period === null && f.category === null && f.account === null) {
      setWant(false);
      setOther(false);
      setPlace(null);
    }
    setFromObservation(false);
  };

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
  // «Желаемое» is purchases only: like a category, it does not narrow income and waits there untouched.
  const chosenWant = withCategories && want;
  // Я8: only once a first page has named them. Payments outside the limit are spending, so, like «желаемое», they wait
  // untouched under «Доходы»; a place narrows every tab, as an account does.
  const serverFilters = useTransactionFilters();
  const chosenOther = withCategories && other && serverFilters.includes("other");
  const chosenPlace = place !== null && serverFilters.includes("place") ? place : null;
  const filter = {
    group: tab,
    ...(account ? { account } : {}),
    ...(chosenPlace ? { place: chosenPlace.key } : {}),
    ...(chosenCategory ? { category: chosenCategory } : {}),
    ...(chosenWant ? { want: true as const } : {}),
    ...(chosenOther ? { other: true as const } : {}),
    ...(period ? { from: period.from, to: period.to } : {}),
    ...(search ? { q: search } : {}),
  };
  const list = useTransactions(filter);
  // A pull belongs to the list it was made on (Я1): another filter ends it, and the list gets a refresh control of
  // its own, so one iOS left spinning (it ends badly while the tab is out of sight) goes with the old list.
  const listKey = JSON.stringify(filter);
  const pull = usePullRefresh(list.refetch, listKey);
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
  const namedKinds = pages[0]?.accountKinds;
  useEffect(() => {
    if (namedKinds) setAccountKinds(namedKinds);
  }, [namedKinds]);
  const items = pages.flatMap((p) => p.items);
  const totals = Object.assign({}, ...pages.map((p) => p.dayTotals)) as Record<string, number | undefined>;
  const today = kyivDate(now());
  const sections = items.reduce<{ date: string; data: TransactionDto[] }[]>((acc, tx) => {
    const lastSection = acc[acc.length - 1];
    if (lastSection?.date === tx.localDate) lastSection.data.push(tx);
    else acc.push({ date: tx.localDate, data: [tx] });
    return acc;
  }, []);
  const filtered = account !== null || chosenPlace !== null || chosenCategory !== null || chosenWant || chosenOther || period !== null;
  const activeFilters = [account !== null, chosenPlace !== null, chosenCategory !== null, chosenWant, chosenOther, period !== null].filter(Boolean).length;
  const emptyText = search || filtered ? "Ничего не нашлось." : TABS.find((t) => t.tab === tab)!.empty;
  const summary = pages[0]?.summary ?? null;
  // Said only while the list is still the observation's: its category over its days.
  const seen = observation.data;
  const noticed =
    fromObservation && seen?.kind === "spike" && seen.category === chosenCategory && period?.from === seen.from && period?.to === seen.to
      ? observationText(seen, categories, today)
      : null;
  const noticedCategory = noticed !== null ? (seen?.category ?? null) : null;
  const summaryTitle = [
    account ? accountLabel(account) : null,
    chosenPlace ? chosenPlace.name : null,
    chosenCategory ? categoryName(chosenCategory, categories) : null,
    chosenWant ? wantLabel(true) : null,
    chosenOther ? "Платежи вне лимита" : null,
    period ? periodLabel(period.from, period.to) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const summaryText = filtered && summary ? `${summaryTitle}: ${formatSignedMoney(summary.total)} · ${operationsText(summary.count)}` : null;
  // The list is one day (a one-day filter) and its heading would say the summary's sum again: the summary keeps it (Я3).
  const oneDayTotal = summaryText !== null && sections.length === 1 ? sections[0]!.date : null;
  const repeatsSummary = (date: string, total: number) => date === oneDayTotal && total === summary?.total;

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
      <Segmented testID="kind-switch" options={TAB_OPTIONS} value={tab} onChange={setTab} />
      {summaryText !== null && (
        <View style={styles.summaryRow}>
          {/* The summary says what is chosen, so pressing it leads to where it is changed (Я3). Its slop stops short
              of the «×» on the right, so the two presses never overlap. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={summaryText}
            accessibilityHint="Открывает фильтры"
            onPress={() => setFiltering(true)}
            hitSlop={{ top: space.md, bottom: space.md, left: space.md, right: 0 }}
            style={styles.summaryPress}
          >
            <Text style={styles.summary}>{summaryText}</Text>
          </Pressable>
          {/* Everything off in one tap (ЯМ2), as «Сбросить» in the window. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Сбросить фильтры"
            onPress={() => applyFilters({ period: null, category: null, account: null })}
            style={styles.clear}
          >
            <View style={styles.clearDot}>
              <Icon name="close" color={color.fg.muted} size={12} />
            </View>
          </Pressable>
        </View>
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
                {total !== undefined && !repeatsSummary(section.date, total) ? <Text style={styles.dayText}>{formatSignedMoney(total)}</Text> : null}
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
          refreshControl={<RefreshControl key={listKey} {...pull} />}
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
          value={{ period, category, account }}
          withCategories={withCategories}
          accounts={accountChoices(accountKinds)}
          onApply={applyFilters}
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
  summaryRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  summaryPress: { flex: 1 },
  // A 44 pt press around a small round mark; the negative margins keep the row as tall as the summary's text.
  clear: {
    minWidth: touchMin,
    minHeight: touchMin,
    marginVertical: -space.sm,
    marginRight: -space.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  clearDot: {
    width: space.xl,
    height: space.xl,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.surface.overlay,
  },  // A solid card, not glass: the observation is text to read, not a floating control.
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
