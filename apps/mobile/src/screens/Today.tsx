import { useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { DailyStateDto, TodayDto } from "@hale/contracts";
import { LimitVisual } from "../metal";
import { formatMoney, formatStamp, formatUsd, kyivDate, longDate } from "../format";
import { useCancelBridge, useChooseBridge, useConfirmIncome, useDeleteLoan, useDismissUsdcMatch, useMatchUsdc, useSetIncomeDate, useToday } from "../api/queries";
import { ErrorText } from "../components/ErrorText";
import { ActionRow } from "../components/ActionRow";
import { BadCaseCard } from "../components/BadCaseCard";
import { BridgePlan } from "../components/BridgePlan";
import { Glass } from "../components/Glass";
import { GoalCards } from "../components/GoalCards";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { QuestionCard, eventIdOf } from "../components/QuestionCard";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { RepayLoanSheet } from "../components/RepayLoanSheet";
import { Sheet } from "../components/Sheet";
import { StaleBanner } from "../components/StaleBanner";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { Upcoming } from "../components/Upcoming";
import { usePullRefresh } from "../usePullRefresh";
import { Settings } from "./Settings";

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

export function Today({ onOpenActivity, onOpenPlan, now = () => new Date() }: Props) {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const confirmIncome = useConfirmIncome();
  const setIncomeDate = useSetIncomeDate();
  const matchUsdc = useMatchUsdc();
  const dismissUsdc = useDismissUsdcMatch();
  const chooseBridge = useChooseBridge();
  const cancelBridge = useCancelBridge();
  const deleteLoan = useDeleteLoan();
  const pull = usePullRefresh(today.refetch);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<"bridge" | "questions" | "settings" | null>(null);
  const [labeling, setLabeling] = useState<{ id: string; counterKey: string; name: string } | null>(null);
  const [repaying, setRepaying] = useState<{ id: number; remaining: number; name: string } | null>(null);

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
  const settingsButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => setSheet("settings")} style={styles.profile}>
      <Icon name="user" color={color.fg.muted} size={20} />
    </Pressable>
  );
  const settingsModal = sheet === "settings" && (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={closeSheet}>
      <Settings onClose={closeSheet} />
    </Modal>
  );

  if (!data) {
    return (
      <View style={styles.root}>
        <View style={[styles.content, { paddingTop: top }]}>
          <View style={styles.headerEnd}>{settingsButton}</View>
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
        {settingsModal}
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
        contentContainerStyle={[styles.content, { paddingTop: space.sm, paddingBottom: space.xl }]}
        refreshControl={<RefreshControl {...pull} />}
      >
        <View style={styles.header}>
          <Text style={styles.date}>{longDate(data.date)}</Text>
          {settingsButton}
        </View>
        <StaleBanner lines={freshnessLines(data, offlineSince, now())} />
        <View style={styles.hero}>
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
            {hasLimit && (
              <View style={styles.spentLine}>
                <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text>
                {usd ? <Text style={styles.subtle}>{usd} сейчас</Text> : null}
              </View>
            )}
            {over && <Text style={styles.note}>Завтра будет новый лимит.</Text>}
            {hasLimit && state.leftToday === 0 && <Text style={styles.note}>Лимит на сегодня использован. Завтра будет новый.</Text>}
            {!hasLimit && <Text style={styles.note}>{noLimitNote}</Text>}
            {!hasLimit && spent > 0 && <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text>}
          </View>
          {level > 0 && (
            <View style={styles.metal} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <LimitVisual mode="mercury" level={level} />
            </View>
          )}
        </View>

        {state.mode === "bridge" && state.bridge && (
          <ActionRow
            label={state.bridge.confirmed ? `План до зарплаты: ${formatMoney(state.dailyLimit)} в день` : "Нужен план до зарплаты"}
            onPress={() => setSheet("bridge")}
          />
        )}
        {questions.length > 0 && <ActionRow label={`Осталось разобрать: ${questions.length}`} onPress={() => setSheet("questions")} />}
        {data.badCases.map((b) => (
          <BadCaseCard
            key={b.id}
            text={b.text}
            onRepay={b.repayLoan && (() => setRepaying({ ...b.repayLoan!, name: b.text.split(". ")[0]! }))}
            onDelete={b.removableLoanId === undefined ? undefined : () => deleteLoan.mutate(b.removableLoanId!, { onError: () => Alert.alert("Не удалось удалить займ", "Проверьте связь и попробуйте ещё раз.") })}
          />
        ))}

        {goals.length > 0 ? <GoalCards goals={goals} /> : <ActionRow label="Добавить цель" onPress={onOpenPlan} />}
        <Upcoming items={data.upcoming} />
      </ScrollView>

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
      {sheet === "questions" && questions.length > 0 && (
        <Sheet title="Осталось разобрать" onClose={closeSheet}>
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
      {repaying && <RepayLoanSheet loanId={repaying.id} remaining={repaying.remaining} name={repaying.name} onClose={() => setRepaying(null)} />}
      {settingsModal}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base },
  headerEnd: { alignItems: "flex-end" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  date: { ...type.label, color: color.fg.default, flexShrink: 1 },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.surface.inset },
  hero: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: color.surface.inset },
  heroText: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: 2 },
  spentLine: { flexDirection: "row", justifyContent: "space-between", gap: space.md, marginTop: space.xs },
  metal: { height: LAYOUT.pool },
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
