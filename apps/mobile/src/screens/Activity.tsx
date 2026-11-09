import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { useTransactions } from "../api/queries";
import { usePullRefresh } from "../usePullRefresh";
import { dayHeader, formatSignedMoney, kyivDate, operationsText, periodLabel } from "../format";
import { categoryLabel } from "../labels";
import { CategorySheet } from "../components/CategorySheet";
import { PeriodSheet, type Period } from "../components/PeriodSheet";
import { ErrorText } from "../components/ErrorText";
import { Chip } from "../components/Chip";
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

/** The operations list by day, newest first, pages by cursor. Transfers between own accounts only show under "Все". */
export function Activity({ now = () => new Date() }: { /** Test seam for the current moment. */ now?: () => Date }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("spend");
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TransactionDto | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [picking, setPicking] = useState<"period" | "category" | null>(null);
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

  const toggleSearch = () => {
    if (searching) {
      setText("");
      setSearch("");
    }
    setSearching(!searching);
  };

  const chosenCategory = tab === "spend" ? category : null;
  const list = useTransactions({
    group: tab,
    ...(chosenCategory ? { category: chosenCategory } : {}),
    ...(period ? { from: period.from, to: period.to } : {}),
    ...(search ? { q: search } : {}),
  });
  const pull = usePullRefresh(list.refetch);
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
  const emptyText = search || filtered ? "Ничего не нашлось." : TABS.find((t) => t.tab === tab)!.empty;
  const summary = pages[0]?.summary ?? null;
  const summaryTitle = [chosenCategory ? categoryLabel(chosenCategory) : null, period ? periodLabel(period.from, period.to) : null].filter(Boolean).join(" · ");

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Операции</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Поиск" accessibilityState={{ expanded: searching }} onPress={toggleSearch} style={styles.searchButton}>
          <Icon name={searching ? "close" : "search"} color={color.fg.muted} size={20} />
        </Pressable>
      </View>
      {searching && <Field label="Поиск по операциям" value={text} onChangeText={setText} maxLength={100} autoFocus returnKeyType="search" />}
      <View style={styles.filters}>
        {TABS.map((t) => (
          <Chip key={t.tab} label={t.label} selected={tab === t.tab} onPress={() => setTab(t.tab)} />
        ))}
      </View>
      <View style={styles.filters}>
        <FilterChip
          label={period ? periodLabel(period.from, period.to) : "Период"}
          openLabel={period ? `Период: ${periodLabel(period.from, period.to)}` : "Период"}
          clearLabel={period ? `Убрать период «${periodLabel(period.from, period.to)}»` : null}
          onOpen={() => setPicking("period")}
          onClear={() => setPeriod(null)}
        />
        {tab === "spend" && (
          <FilterChip
            label={chosenCategory ? categoryLabel(chosenCategory) : "Категория"}
            openLabel={chosenCategory ? `Категория: ${categoryLabel(chosenCategory)}` : "Категория"}
            clearLabel={chosenCategory ? `Убрать категорию «${categoryLabel(chosenCategory)}»` : null}
            onOpen={() => setPicking("category")}
            onClear={() => setCategory(null)}
          />
        )}
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
            <TxRow tx={item} onPress={() => setOpen(item)} first={index === 0} last={index === section.data.length - 1} />
          )}
          contentContainerStyle={{ paddingBottom: LAYOUT.tabBar + insets.bottom }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
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
      {picking === "period" && <PeriodSheet today={kyivDate(now())} value={period} onPick={setPeriod} onClose={() => setPicking(null)} />}
      {picking === "category" && <CategorySheet onPick={setCategory} onClose={() => setPicking(null)} />}
      {open && !open.manual && !showAnswer && (
        <TxEditSheet tx={open} onClose={close} onAnswer={isTransferToSomeone(open) ? () => setSheet("answer") : undefined} />
      )}
    </View>
  );
}

/** A filter: names what it holds and opens its window; once something is chosen, a cross clears it. */
function FilterChip(p: { label: string; openLabel: string; clearLabel: string | null; onOpen: () => void; onClear: () => void }) {
  const on = p.clearLabel !== null;
  return (
    <View style={[styles.filter, on && styles.filterOn]}>
      <Pressable accessibilityRole="button" accessibilityLabel={p.openLabel} onPress={p.onOpen} style={styles.filterPress}>
        <Text style={[styles.filterText, on && styles.filterTextOn]}>{p.label}</Text>
      </Pressable>
      {on && (
        <Pressable accessibilityRole="button" accessibilityLabel={p.clearLabel!} onPress={p.onClear} style={styles.filterClear}>
          <Icon name="close" color={color.accent.fgOnAccent} size={14} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filter: { minHeight: touchMin, flexDirection: "row", alignItems: "center", borderRadius: radius.full, backgroundColor: color.surface.overlay },
  filterOn: { backgroundColor: color.accent.default },
  filterPress: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.lg },
  filterText: { ...type.label, color: color.fg.default },
  filterTextOn: { color: color.accent.fgOnAccent },
  filterClear: { minHeight: touchMin, minWidth: touchMin - space.sm, alignItems: "center", justifyContent: "center", paddingRight: space.sm },
  summary: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  root: { flex: 1, paddingHorizontal: space.xl, gap: space.md },
  title: { ...type.title, color: color.fg.default },
  filters: { flexDirection: "row", gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  searchButton: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  day: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingTop: space.lg, paddingBottom: space.sm },
  dayText: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  stack: { gap: space.md },
  text: { ...type.body, color: color.fg.default },
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
