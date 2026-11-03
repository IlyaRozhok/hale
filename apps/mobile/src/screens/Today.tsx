import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { DailyStateDto, TodayDto } from "@hale/contracts";
import { LimitVisual } from "../metal";
import { formatMoney, formatStamp, formatUsd, kyivDate, longDate } from "../format";
import { useChooseBridge, useConfirmIncome, useDismissUsdcMatch, useMatchUsdc, useSetIncomeDate, useToday } from "../api/queries";
import { ActionRow } from "../components/ActionRow";
import { BadCaseCard } from "../components/BadCaseCard";
import { BridgePlan } from "../components/BridgePlan";
import { Glass } from "../components/Glass";
import { GoalCards } from "../components/GoalCards";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { QuestionCard } from "../components/QuestionCard";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { Sheet } from "../components/Sheet";
import { StaleBanner } from "../components/StaleBanner";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { Upcoming } from "../components/Upcoming";
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
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<"bridge" | "questions" | "settings" | null>(null);
  const [labeling, setLabeling] = useState<{ id: string; counterKey: string; name: string } | null>(null);

  const hide = (id: string, on: boolean) =>
    setAnswered((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const data = today.data;
  const top = insets.top + space.lg;

  if (!data) {
    return (
      <View style={styles.root}>
        <View style={[styles.content, { paddingTop: top }]}>
          {today.isError ? (
            <Glass style={styles.stack}>
              <Text style={styles.body}>Не получилось загрузить данные. Проверьте связь и попробуйте ещё раз.</Text>
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
  const usd = formatUsd(state.leftToday, data.usdRate);
  const offlineSince = today.isError ? today.dataUpdatedAt : null;
  const questions = data.questions.filter((q) => !answered.has(q.id));
  const hasLimit = state.dailyLimit > 0;
  const noLimitNote = state.mode === "bridge" ? "Лимит появится, когда вы подтвердите план ниже." : "До следующего дохода свободных денег нет.";

  const answer = (id: string, run: () => Promise<unknown>) => {
    const last = questions.length <= 1;
    hide(id, true);
    run().then(
      () => {
        if (last) setSheet(null);
      },
      () => hide(id, false),
    );
  };

  const goals = data.goals ?? [];
  const closeSheet = () => setSheet(null);

  return (
    <View style={styles.root}>
      <ScrollView
        style={{ marginTop: insets.top }}
        contentContainerStyle={[styles.content, { paddingTop: space.sm, paddingBottom: space.xl }]}
        refreshControl={<RefreshControl refreshing={today.isRefetching && !today.isPending} onRefresh={() => void today.refetch()} />}
      >
        <View style={styles.header}>
          <Text style={styles.date}>{longDate(data.date)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => setSheet("settings")} style={styles.profile}>
            <Icon name="user" color={color.fg.muted} size={20} />
          </Pressable>
        </View>
        <StaleBanner lines={freshnessLines(data, offlineSince, now())} />
        <View style={styles.hero}>
          <View
            style={styles.heroText}
            accessible
            accessibilityLabel={
              hasLimit
                ? `Сегодня можно ${formatMoney(state.leftToday)}, из ${formatMoney(state.dailyLimit)} на день`
                : `Сегодня можно ${formatMoney(state.leftToday)}. ${noLimitNote}`
            }
          >
            <Text style={styles.eyebrow}>Сегодня можно</Text>
            <Text style={styles.amount}>{formatMoney(state.leftToday)}</Text>
            {hasLimit && <Text style={styles.note}>{limitNote(state)}</Text>}
            {hasLimit && usd ? <Text style={styles.subtle}>{usd} сейчас</Text> : null}
            {hasLimit && state.leftToday <= 0 && <Text style={styles.note}>Лимит на сегодня использован. Завтра будет новый.</Text>}
            {!hasLimit && <Text style={styles.note}>{noLimitNote}</Text>}
          </View>
          <View style={styles.metal} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LimitVisual mode="mercury" level={level} />
          </View>
        </View>

        {state.mode === "bridge" && state.bridge && (
          <ActionRow
            label={state.bridge.confirmed ? `План до зарплаты: ${formatMoney(state.dailyLimit)} в день` : "Нужен план до зарплаты"}
            onPress={() => setSheet("bridge")}
          />
        )}
        {questions.length > 0 && <ActionRow label={`Осталось разобрать: ${questions.length}`} onPress={() => setSheet("questions")} />}
        {data.badCases.map((b) => (
          <BadCaseCard key={b.id} text={b.text} />
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
            onConfirm={(amount) => chooseBridge.mutate(amount, { onSuccess: closeSheet })}
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
              onOpenActivity={onOpenActivity}
              onLabelRecipient={(counterKey) => {
                // Two modals cannot stack: the list closes before the label sheet opens.
                setSheet(null);
                setLabeling({ id: q.id, counterKey, name: q.text.replace(/^Кто это:\s*/, "").replace(/\?$/, "") });
              }}
              onConfirmUsdc={(eventId) => answer(q.id, () => confirmIncome.mutateAsync(eventId))}
              onMatchUsdc={(eventId, transactionId) => answer(q.id, () => matchUsdc.mutateAsync({ eventId, transactionId }))}
              onDismissUsdc={(transactionId) => answer(q.id, () => dismissUsdc.mutateAsync(transactionId))}
              onSetDate={(eventId, date) => answer(q.id, () => setIncomeDate.mutateAsync({ eventId, date }))}
            />
          ))}
        </Sheet>
      )}
      {sheet === "settings" && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={closeSheet}>
          <Settings onClose={closeSheet} />
        </Modal>
      )}
      {labeling && (
        <RecipientLabelSheet
          counterKey={labeling.counterKey}
          name={labeling.name}
          onClose={() => setLabeling(null)}
          onLabeled={() => hide(labeling.id, true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  date: { ...type.label, color: color.fg.default, flexShrink: 1 },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.surface.inset },
  hero: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: color.surface.inset },
  heroText: { paddingHorizontal: space.lg, paddingTop: space.lg },
  metal: { height: LAYOUT.pool },
  content: { paddingHorizontal: space.xl, gap: space.lg },
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
