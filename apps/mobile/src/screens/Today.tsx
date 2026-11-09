import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { DailyStateDto, TodayDto } from "@hale/contracts";
import { MetalBar } from "../metal";
import { formatMoney, formatStamp, formatUsd, kyivDate, longDate, streakLabel } from "../format";
import { useCancelBridge, useChooseBridge, useConfirmIncome, useDeleteLoan, useAnswerCashCard, useDepositFromWallet, useDismissUsdcMatch, useMatchUsdc, useSetIncomeDate, useToday } from "../api/queries";
import { CashOperationSheet } from "../components/CashOperationSheet";
import { PaymentPaidSheet } from "../components/PaymentPaidSheet";
import { ErrorText } from "../components/ErrorText";
import { ActionRow } from "../components/ActionRow";
import { BadCaseCard } from "../components/BadCaseCard";
import { BridgePlan } from "../components/BridgePlan";
import { Glass } from "../components/Glass";
import { GoalCards } from "../components/GoalCards";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { LimitCalendar } from "../components/LimitCalendar";
import { QuestionCard, eventIdOf } from "../components/QuestionCard";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { RepayLoanSheet } from "../components/RepayLoanSheet";
import { Sheet } from "../components/Sheet";
import { StaleBanner } from "../components/StaleBanner";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { Upcoming } from "../components/Upcoming";
import { usePullRefresh } from "../usePullRefresh";

const { color, radius, space, touchMin, type } = tokens;

type Props = { onOpenActivity: () => void; onOpenPlan: () => void; /** Test seam for the current moment. */ now?: () => Date };

function freshnessLines(data: TodayDto, offlineSince: number | null, now: Date): string[] {
  const lines: string[] = [];
  if (data.date !== kyivDate(now)) {
    lines.push(`Показаны данные за ${data.date.slice(8, 10)}.${data.date.slice(5, 7)}, не за сегодня.`);
  }
  if (offlineSince !== null) {
    lines.push(`Нет связи. Показаны данные от ${formatStamp(new Date(offlineSince).toISOString())}.`);
  }
  if (data.syncStale) {
    lines.push(
      data.syncedAt
        ? `Банк обновлялся ${formatStamp(data.syncedAt)}. Показаны последние данные.`
        : "Синхронизации с банком ещё не было.",
    );
  }
  return lines;
}

function limitNote(state: DailyStateDto): string {
  const limit = formatMoney(state.dailyLimit);
  return !state.needsIncomeDate && state.daysLeft > 0 ? `из ${limit} · до зарплаты ${state.daysLeft} дн` : `из ${limit} на день`;
}

export function Today({ onOpenActivity, now = () => new Date() }: Props) {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const confirmIncome = useConfirmIncome();
  const setIncomeDate = useSetIncomeDate();
  const matchUsdc = useMatchUsdc();
  const dismissUsdc = useDismissUsdcMatch();
  const fromWallet = useDepositFromWallet();
  const cashCard = useAnswerCashCard();
  const chooseBridge = useChooseBridge();
  const cancelBridge = useCancelBridge();
  const deleteLoan = useDeleteLoan();
  const pull = usePullRefresh(today.refetch);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<"bridge" | "questions" | "calendar" | "cash" | null>(null);
  const [labeling, setLabeling] = useState<{ id: string; counterKey: string; name: string } | null>(null);
  const [paying, setPaying] = useState<TodayDto["upcoming"][number] | null>(null);
  const [repaying, setRepaying] = useState<{ id: number; remaining: number; receivedOn?: string; name: string } | null>(null);

  const hide = (id: string, on: boolean) =>
    setAnswered((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const data = today.data;
  const top = insets.top + space.sm;
  const closeSheet = () => setSheet(null);
  /** Closes the sheet only if it is still the one open: a late answer must not close another. */
  const closeIfOpen = (name: "bridge" | "questions") => setSheet((s) => (s === name ? null : s));

  if (!data) {
    return (
      <View style={styles.root}>
        <View style={[styles.content, { paddingTop: top }]}>
          {today.isError ? (
            <Glass style={styles.stack}>
              <ErrorText>Не получилось загрузить данные. Проверьте связь и попробуйте ещё раз.</ErrorText>
              <Pressable accessibilityRole="button" onPress={() => void today.refetch()} style={styles.button}>
                <Text style={styles.buttonText}>Повторить</Text>
              </Pressable>
            </Glass>
          ) : (
            <TodaySkeleton />
          )}
        </View>
      </View>
    );
  }

  const { state } = data;
  const level = state.leftToday > 0 ? Math.min(1, Math.max(0, state.level)) : 0;
  const hasLimit = state.dailyLimit > 0;
  const over = hasLimit && state.leftToday < 0;
  const spent = Math.max(0, state.dailyLimit - state.leftToday);
  const shownLeft = over ? -state.leftToday : Math.max(0, state.leftToday);
  const usd = formatUsd(shownLeft, data.usdRate);
  const heading = over ? "Сверх лимита" : "Сегодня можно";
  const offlineSince = today.isError ? today.dataUpdatedAt : null;
  // A date question with no income event cannot be answered; an older cached answer may still hold one.
  const questions = data.questions.filter((q) => !answered.has(q.id) && !(q.kind === "income_date" && eventIdOf(q.id) === null));
  const noLimitNote = state.mode === "bridge" ? "Лимит появится, когда вы подтвердите план." : "До следующего дохода свободных денег нет.";

  const answer = (id: string, run: () => Promise<unknown>) => {
    const last = questions.length <= 1;
    hide(id, true);
    run().then(
      () => {
        if (last) closeIfOpen("questions");
      },
      () => hide(id, false),
    );
  };

  const goals = data.goals ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        testID="today-scroll"
        style={{ marginTop: insets.top }}
        contentContainerStyle={[styles.content, { paddingTop: space.sm, paddingBottom: LAYOUT.tabBar + insets.bottom }]}
        refreshControl={<RefreshControl {...pull} />}
      >
        <View style={styles.header}>
          <Text style={styles.date}>{longDate(data.date)}</Text>
          <View style={styles.headerButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={questions.length > 0 ? `Вопросы: ${questions.length}` : "Вопросы"}
              onPress={() => setSheet("questions")}
              style={styles.profile}
            >
              <Icon name="bell" color={color.fg.muted} size={20} />
              {questions.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{questions.length}</Text>
                </View>
              )}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Добавить операцию" onPress={() => setSheet("cash")} style={styles.profile}>
              <Icon name="plus" color={color.fg.muted} size={20} />
            </Pressable>
          </View>
        </View>
        <StaleBanner lines={freshnessLines(data, offlineSince, now())} />
        <Glass style={styles.hero}>
          <View
            style={styles.heroText}
            accessible
            accessibilityLabel={
              hasLimit
                ? `${heading} ${formatMoney(shownLeft)}, из ${formatMoney(state.dailyLimit)} на день`
                : `${heading} ${formatMoney(shownLeft)}. ${noLimitNote}`
            }
          >
            <Text style={styles.eyebrow}>{heading}</Text>
            <Text style={styles.amount}>{formatMoney(shownLeft)}</Text>
            {hasLimit && <Text style={styles.note}>{limitNote(state)}</Text>}
            {hasLimit && usd ? <Text style={styles.subtle}>{usd} сейчас</Text> : null}
            {over && <Text style={styles.note}>Завтра будет новый лимит.</Text>}
            {hasLimit && state.leftToday === 0 && <Text style={styles.note}>Лимит на сегодня использован. Завтра будет новый.</Text>}
            {!hasLimit && <Text style={styles.note}>{noLimitNote}</Text>}
          </View>
          {hasLimit && (
            <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <MetalBar level={level} />
            </View>
          )}
          <View style={styles.quiet}>
            {hasLimit || spent > 0 ? <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text> : <View />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={streakLabel(data.streak ?? 0)}
              onPress={() => setSheet("calendar")}
              style={styles.streak}
            >
              <Text style={styles.subtle}>{(data.streak ?? 0) > 0 ? streakLabel(data.streak ?? 0).replace(/^Серия: /, "") : "Календарь"}</Text>
            </Pressable>
          </View>
        </Glass>

        {state.mode === "bridge" && state.bridge && (
          <ActionRow
            label={state.bridge.confirmed ? `План до зарплаты: ${formatMoney(state.dailyLimit)} в день` : "Нужен план до зарплаты"}
            onPress={() => setSheet("bridge")}
          />
        )}
        {data.badCases.map((b) => (
          <BadCaseCard
            key={b.id}
            text={b.text}
            onRepay={b.repayLoan && (() => setRepaying({ ...b.repayLoan!, name: b.text.split(". ")[0]! }))}
            onDelete={b.removableLoanId === undefined ? undefined : () => deleteLoan.mutate(b.removableLoanId!, { onError: () => Alert.alert("Не удалось удалить займ", "Проверьте связь и попробуйте ещё раз.") })}
          />
        ))}

        {goals.length > 0 && <GoalCards goals={goals} />}
        <Upcoming items={data.upcoming} today={data.date} onPress={setPaying} />
      </ScrollView>

      {sheet === "cash" && <CashOperationSheet onClose={closeSheet} />}
      {sheet === "calendar" && <LimitCalendar today={data.date} streak={data.streak ?? 0} onClose={closeSheet} />}
      {sheet === "bridge" && state.bridge && (
        <Sheet title="План до зарплаты" onClose={closeSheet}>
          <BridgePlan
            state={state}
            usdRate={data.usdRate}
            confirming={chooseBridge.isPending}
            onConfirm={(amount) => chooseBridge.mutate(amount, { onSuccess: () => closeIfOpen("bridge") })}
            onCancel={() => cancelBridge.mutate(undefined, {
                onSuccess: () => closeIfOpen("bridge"),
                onError: () => Alert.alert("Не удалось отменить план", "Проверьте связь и попробуйте ещё раз."),
              })}
          />
        </Sheet>
      )}
      {sheet === "questions" && (
        <Sheet title="Осталось разобрать" onClose={closeSheet}>
          {questions.length === 0 && <Text style={styles.note}>Вопросов нет</Text>}
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              today={data.date}
              onOpenActivity={() => {
                closeSheet();
                onOpenActivity();
              }}
              onLabelRecipient={(counterKey) => setLabeling({ id: q.id, counterKey, name: q.subject ?? q.text.replace(/^Кто это:\s*/, "").replace(/\?$/, "") })}
              onConfirmUsdc={(eventId) => answer(q.id, () => confirmIncome.mutateAsync(eventId))}
              onMatchUsdc={(eventId, transactionId) => answer(q.id, () => matchUsdc.mutateAsync({ eventId, transactionId }))}
              onDismissUsdc={(transactionId) => answer(q.id, () => dismissUsdc.mutateAsync(transactionId))}
              onCashFromWallet={(transactionId) => answer(q.id, () => fromWallet.mutateAsync(transactionId))}
              onCashCard={(transactionId, reply) => answer(q.id, () => cashCard.mutateAsync({ id: transactionId, answer: reply }))}
              onSetDate={(eventId, date) => answer(q.id, () => setIncomeDate.mutateAsync({ eventId, date }))}
            />
          ))}
          {/* Inside the list's modal: iOS presents it on top, and closing it returns to the list. */}
          {labeling && (
            <RecipientLabelSheet
              counterKey={labeling.counterKey}
              name={labeling.name}
              onClose={() => setLabeling(null)}
              onLabeled={() => hide(labeling.id, true)}
            />
          )}
        </Sheet>
      )}
      {paying && <PaymentPaidSheet payment={paying} today={data.date} onClose={() => setPaying(null)} />}
      {repaying && <RepayLoanSheet loanId={repaying.id} remaining={repaying.remaining} receivedOn={repaying.receivedOn} name={repaying.name} onClose={() => setRepaying(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerButtons: { flexDirection: "row", gap: space.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  date: { ...type.label, color: color.fg.default, flexShrink: 1 },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.glass.row },
  hero: { overflow: "hidden", paddingHorizontal: 0, paddingVertical: 0 },
  heroText: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: 2 },
  bar: { paddingHorizontal: space.lg, marginTop: space.md },
  quiet: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xs },
  streak: { minHeight: touchMin, justifyContent: "center" },
  badge: {
    position: "absolute",
    top: space.xs,
    right: space.xs,
    minWidth: space.lg,
    height: space.lg,
    paddingHorizontal: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.accent.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...type.caption, fontWeight: "500", color: color.accent.fgOnSignal },
  content: { paddingHorizontal: space.xl, gap: space.md },
  stack: { gap: space.md },
  eyebrow: { ...type.body, color: color.fg.muted, height: LAYOUT.eyebrow + 4 },
  amount: { fontSize: 52, lineHeight: LAYOUT.amount, fontWeight: "500", color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.body, color: color.fg.muted },
  subtle: { ...type.caption, color: color.fg.subtle },
  body: { ...type.body, color: color.fg.default },
  button: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  buttonText: { ...type.label, color: color.accent.fgOnAccent },
});
