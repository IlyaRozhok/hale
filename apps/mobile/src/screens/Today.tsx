import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { LimitVisual } from "../metal";
import { formatMoney, formatStamp, formatUsd, kyivDate } from "../format";
import { useChooseBridge, useConfirmIncome, useDismissUsdcMatch, useMatchUsdc, useSetIncomeDate, useToday } from "../api/queries";
import { AccountsList } from "../components/AccountsList";
import { BadCaseCard } from "../components/BadCaseCard";
import { BridgePlan } from "../components/BridgePlan";
import { Glass } from "../components/Glass";
import { LAYOUT } from "../components/layout";
import { QuestionCard } from "../components/QuestionCard";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { StaleBanner } from "../components/StaleBanner";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { Upcoming } from "../components/Upcoming";

const { color, radius, space, touchMin, type } = tokens;

type Props = { onOpenActivity: () => void; /** Test seam for the current moment. */ now?: () => Date };

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

export function Today({ onOpenActivity, now = () => new Date() }: Props) {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const confirmIncome = useConfirmIncome();
  const setIncomeDate = useSetIncomeDate();
  const matchUsdc = useMatchUsdc();
  const dismissUsdc = useDismissUsdcMatch();
  const chooseBridge = useChooseBridge();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
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

  const answer = (id: string, run: () => Promise<unknown>) => {
    hide(id, true);
    run().catch(() => hide(id, false));
  };

  return (
    <View style={styles.root}>
      <View style={styles.metal} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LimitVisual mode={data.limitVisual} level={level} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: insets.bottom + space.xl }]}
        refreshControl={<RefreshControl refreshing={today.isRefetching && !today.isPending} onRefresh={() => void today.refetch()} />}
      >
        <StaleBanner lines={freshnessLines(data, offlineSince, now())} />
        <Glass
          accessible
          accessibilityLabel={`Сегодня можно ${formatMoney(state.leftToday)}, из ${formatMoney(state.dailyLimit)} на день`}
        >
          <Text style={styles.eyebrow}>Сегодня можно</Text>
          <Text style={styles.amount}>{formatMoney(state.leftToday)}</Text>
          <Text style={styles.note}>{`из ${formatMoney(state.dailyLimit)} на день`}</Text>
          {usd ? <Text style={styles.subtle}>{usd} сейчас</Text> : null}
          {state.leftToday <= 0 && <Text style={styles.note}>Лимит на сегодня использован. Завтра будет новый.</Text>}
        </Glass>

        {state.mode === "bridge" && state.bridge && (
          <BridgePlan
            state={state}
            usdRate={data.usdRate}
            confirming={chooseBridge.isPending}
            onConfirm={(amount) => chooseBridge.mutate(amount)}
          />
        )}

        {data.badCases.map((b) => (
          <BadCaseCard key={b.id} text={b.text} />
        ))}
        {questions.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            today={data.date}
            onOpenActivity={onOpenActivity}
            onLabelRecipient={(counterKey) => setLabeling({ id: q.id, counterKey, name: q.text.replace(/^Кто это:\s*/, "").replace(/\?$/, "") })}
            onConfirmUsdc={(eventId) => answer(q.id, () => confirmIncome.mutateAsync(eventId))}
            onMatchUsdc={(eventId, transactionId) => answer(q.id, () => matchUsdc.mutateAsync({ eventId, transactionId }))}
            onDismissUsdc={(transactionId) => answer(q.id, () => dismissUsdc.mutateAsync(transactionId))}
            onSetDate={(eventId, date) => answer(q.id, () => setIncomeDate.mutateAsync({ eventId, date }))}
          />
        ))}

        <AccountsList accounts={data.accounts} usdRate={data.usdRate} />
        <Upcoming items={data.upcoming} today={data.date} usdRate={data.usdRate} />
      </ScrollView>
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
  metal: { position: "absolute", left: 0, right: 0, bottom: 0, height: "56%" },
  content: { paddingHorizontal: space.xl, gap: space.lg },
  stack: { gap: space.md },
  eyebrow: { ...type.body, color: color.fg.muted, height: LAYOUT.eyebrow + 4 },
  amount: { fontSize: 72, lineHeight: LAYOUT.amount, fontWeight: "500", color: color.fg.default, fontVariant: ["tabular-nums"] },
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
