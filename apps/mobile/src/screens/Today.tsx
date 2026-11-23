import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { ObservationRef, TodayDto } from "@hale/contracts";
import { LimitBar } from "../metal";
import { limitState } from "../limitState";
import { formatMoney, formatStamp, kyivDate, longDate, shiftDate, streakLabel } from "../format";
import { dayPhrase, observationRef, type PhraseAction } from "../dayPhrase";
import {
  useAnswerCashCard,
  useCalendar,
  useCancelBridge,
  useCategoryList,
  useChooseBridge,
  useConfirmIncome,
  useDepositFromWallet,
  useDismissObservation,
  useDismissPaymentMatch,
  useDismissUsdcMatch,
  useInsights,
  useMarkObservationShown,
  useMatchUsdc,
  useObservation,
  usePayWith,
  useSetIncomeDate,
  useToday,
} from "../api/queries";
import { PaymentPaidSheet } from "../components/PaymentPaidSheet";
import { ErrorText } from "../components/ErrorText";
import { BadCaseCard } from "../components/BadCaseCard";
import { BridgePlan } from "../components/BridgePlan";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";
import { LAYOUT } from "../components/layout";
import { LimitCalendar } from "../components/LimitCalendar";
import { LoansSheet } from "../components/LoansSheet";
import { PaceSheet, paceLineText } from "../components/PaceSheet";
import { QuestionCard, eventIdOf } from "../components/QuestionCard";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { Runway } from "../components/Runway";
import { Sheet } from "../components/Sheet";
import { StaleBanner } from "../components/StaleBanner";
import { SubscriptionsSheet } from "../components/SubscriptionsSheet";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { UsdcArrivedSheet } from "../components/UsdcArrivedSheet";
import { usePullRefresh } from "../usePullRefresh";
import { ApiError } from "../api/client";

const { color, radius, space, touchMin, type } = tokens;

type Props = {
  /** Opens the operations; with a date, those of that one day. */
  onOpenActivity: (day?: string) => void;
  /** Opens the operations on the category and days of the phrase's observation (task В7). */
  onOpenObservation?: (category: string, from: string, to: string) => void;
  /** Test seam for the current moment. */
  now?: () => Date;
};

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

export function Today({ onOpenActivity, onOpenObservation, now = () => new Date() }: Props) {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const confirmIncome = useConfirmIncome();
  const setIncomeDate = useSetIncomeDate();
  const matchUsdc = useMatchUsdc();
  const dismissUsdc = useDismissUsdcMatch();
  const fromWallet = useDepositFromWallet();
  const cashCard = useAnswerCashCard();
  const payWith = usePayWith();
  const notPaidBy = useDismissPaymentMatch();
  const chooseBridge = useChooseBridge();
  const cancelBridge = useCancelBridge();
  const pull = usePullRefresh(today.refetch);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<"bridge" | "questions" | "calendar" | "loans" | "subscriptions" | "pace" | null>(null);
  const [labeling, setLabeling] = useState<{ id: string; counterKey: string; name: string } | null>(null);
  const [arriving, setArriving] = useState<{ id: string; eventId: number; expectedAmount: number } | null>(null);
  const [paying, setPaying] = useState<TodayDto["upcoming"][number] | null>(null);

  const hide = (id: string, on: boolean) =>
    setAnswered((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const data = today.data;
  // How yesterday went, for the phrase of the day. It waits for today's date and may never come: then the phrase is about something else.
  const dayBefore = data ? shiftDate(data.date, -1) : null;
  const calendar = useCalendar(dayBefore?.slice(0, 7) ?? "", dayBefore !== null);
  // The day before yesterday (А24), for «Вчера — ближе к лимиту, чем позавчера.». Mostly the same month and so the
  // same cached query; on the 2nd it is the previous month's last day, and that month is loaded too.
  const twoDaysAgo = data ? shiftDate(data.date, -2) : null;
  const calendarBefore = useCalendar(twoDaysAgo?.slice(0, 7) ?? "", twoDaysAgo !== null);
  // Today's observation (В7): said in the phrase only on a day with nothing more pressing. An older server has none.
  const observation = useObservation();
  const categories = useCategoryList();
  const markShown = useMarkObservationShown();
  const dismissObservation = useDismissObservation();
  // The subscriptions' list opens from the phrase with the figures «Итоги» show it with.
  const insights = useInsights(undefined, observation.data?.kind === "subscriptions");
  const subscriptions = insights.data?.subscriptions ?? null;
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
  // Owner's choice: an overspent day looks like any day; only the strip's spark turns red.
  const heading = "Сегодня можно";
  const dayState = limitState(state);
  // The day the shortage mode came on, while it still runs on the limit it began with: what is already spent
  // is not set against the new one. Once the day's limit is the new one the server names none for tomorrow.
  const nextLimit = state.shortageStart?.nextLimit;
  const nextLimitNote = nextLimit !== undefined ? `Новый лимит ${formatMoney(nextLimit)} действует с завтра` : null;
  const offlineSince = today.isError ? today.dataUpdatedAt : null;
  // A date question with no income event cannot be answered; an older cached answer may still hold one.
  const questions = data.questions.filter((q) => !answered.has(q.id) && !(q.kind === "income_date" && eventIdOf(q.id) === null));
  // Loans live in Plan: the server still lists each open one here, and Today leaves them out.
  const notes = data.badCases.filter((b) => !b.id.startsWith("loan:"));
  // Task А24: the sand line about the pace. The note that the minus went over the bridge plan already names the day
  // the money runs out, so with it on the screen the line is left out (loan notes are not shown here).
  const paceLine = data.pace && !notes.some((b) => b.id.startsWith("bridge_over_plan:")) ? paceLineText(data.pace, data.date) : null;
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

  const phrase = dayPhrase({
    today: data.date,
    dailyLimit: state.dailyLimit,
    needsPlan: state.mode === "bridge" && state.bridge !== null && !state.bridge.confirmed,
    questions: questions.length,
    upcoming: data.upcoming,
    loansDue: data.loansDue,
    yesterday: calendar.data?.days.find((d) => d.date === dayBefore) ?? null,
    dayBefore: calendarBefore.data?.days.find((d) => d.date === twoDaysAgo) ?? null,
    streak: data.streak ?? 0,
    observation: observation.data,
    categories,
    // Task Я2: with the pace line or an overspent day on the screen the observation is not said, nor marked shown.
    quiet: paceLine !== null || over,
  });
  const noticed = phrase?.action.kind === "observation" ? observationRef(phrase.action.observation) : null;
  const act = (action: PhraseAction) => {
    if (action.kind === "pay") setPaying(action.payment);
    else if (action.kind === "observation") {
      const o = action.observation;
      // A spike shows where it came from; the subscriptions are still to come, so their list, not past operations.
      if (o.kind === "subscriptions") setSheet("subscriptions");
      else if (o.category !== null) onOpenObservation?.(o.category, o.from, o.to);
    } else setSheet(action.kind);
  };
  // Task Я2: once nothing is left the line names the limit once, as tomorrow's, not also as «из ₴Y».
  const spentLine = state.leftToday <= 0
    ? `потрачено ${formatMoney(spent)} · завтра снова ${formatMoney(state.dailyLimit)}`
    : `потрачено ${formatMoney(spent)} из ${formatMoney(state.dailyLimit)}`;
  const limitLabel = hasLimit && nextLimitNote
    ? `${heading} ${formatMoney(over ? 0 : shownLeft)}. ${nextLimitNote}`
    : hasLimit && state.leftToday <= 0
    ? `${heading} ${formatMoney(0)}, потрачено ${formatMoney(spent)}, завтра снова ${formatMoney(state.dailyLimit)}`
    : hasLimit
      ? `${heading} ${formatMoney(shownLeft)}, из ${formatMoney(state.dailyLimit)} на день`
      : `${heading} ${formatMoney(shownLeft)}. ${noLimitNote}`;

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
        </View>
        <StaleBanner lines={freshnessLines(data, offlineSince, now())} />
        {/* The whole card is the way into the limit calendar. */}
        <Pressable accessibilityRole="button" accessibilityLabel={limitLabel} accessibilityHint={streakLabel(data.streak ?? 0)} onPress={() => setSheet("calendar")} style={styles.heroPress}>
          <Glass kind="card" style={styles.hero}>
            <Text style={styles.eyebrow}>{heading}</Text>
            <Text style={styles.amount}>{over ? formatMoney(0) : formatMoney(shownLeft)}</Text>
            {!hasLimit && <Text style={styles.note}>{noLimitNote}</Text>}
            {!hasLimit && spent > 0 && <Text style={styles.subtle}>Потрачено {formatMoney(spent)}</Text>}
            {hasLimit && (
              <>
                <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <LimitBar level={level} state={dayState} />
                </View>
                <Text style={[styles.subtle, styles.spentLine]}>
                  {nextLimitNote ?? spentLine}
                </Text>
              </>
            )}
          </Glass>
        </Pressable>

        {paceLine && data.pace && (
          <Pressable accessibilityRole="button" accessibilityLabel={paceLine} accessibilityHint="Открывает темп трат" onPress={() => setSheet("pace")} style={styles.paceRow}>
            <Text style={styles.paceText}>{paceLine}</Text>
            <Icon name="chevron" color={color.limit.low} size={16} />
          </Pressable>
        )}
        {phrase && (
          <Pressable accessibilityRole="button" onPress={() => act(phrase.action)} style={styles.phraseRow}>
            <Text style={styles.phrase}>{phrase.text}</Text>
          </Pressable>
        )}
        {noticed && <MarkShown date={data.date} which={noticed} mark={markShown} />}

        {data.runway && (
          <View style={styles.runway}>
            <Runway runway={data.runway} today={data.date} onPay={(id) => setPaying(data.upcoming.find((p) => p.id === id) ?? null)} />
          </View>
        )}

        {state.mode === "bridge" && state.bridge?.confirmed && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`План до дохода: ${formatMoney(state.dailyLimit)} в день`}
            onPress={() => setSheet("bridge")}
            style={styles.planRow}
          >
            <Icon name="route" color={color.fg.muted} size={18} />
            <Text style={styles.planText}>План до дохода</Text>
            <Text style={styles.planAmount}>{`${formatMoney(state.dailyLimit)} в день`}</Text>
            <Icon name="chevron" color={color.fg.subtle} size={16} />
          </Pressable>
        )}
        {notes.map((b) => (
          <BadCaseCard key={b.id} text={b.text} />
        ))}
      </ScrollView>

      {/* A loan to return opens the same list as in Plan (task Б7). */}
      {sheet === "loans" && <LoansSheet onClose={closeSheet} />}
      {sheet === "pace" && data.pace && <PaceSheet pace={data.pace} dailyLimit={state.dailyLimit} today={data.date} onClose={closeSheet} />}
      {sheet === "calendar" && (
        <LimitCalendar
          today={data.date}
          streak={data.streak ?? 0}
          onClose={closeSheet}
          onOpenDay={(date) => {
            closeSheet();
            onOpenActivity(date);
          }}
        />
      )}
      {sheet === "bridge" && state.bridge && (
        <Sheet
          title="План до дохода"
          onClose={() => {
            chooseBridge.reset(); // a failed confirm is not carried to the next time the plan opens
            closeSheet();
          }}
        >
          <BridgePlan
            state={state}
            usdRate={data.usdRate}
            creditLimit={data.accounts.credit}
            confirming={chooseBridge.isPending}
            zeroOn={data.runway?.zeroOn ?? null}
            today={data.date}
            onMove={() => {
              if (chooseBridge.isError) chooseBridge.reset();
            }}
            confirmFailed={chooseBridge.error ? (chooseBridge.error instanceof ApiError && chooseBridge.error.status === 422 ? "refused" : "failed") : null}
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
              onConfirmUsdc={(eventId) => answer(q.id, () => confirmIncome.mutateAsync({ eventId }))}
              onUsdcOther={(eventId, expectedAmount) => setArriving({ id: q.id, eventId, expectedAmount })}
              onMatchUsdc={(eventId, transactionId) => answer(q.id, () => matchUsdc.mutateAsync({ eventId, transactionId }))}
              onDismissUsdc={(transactionId) => answer(q.id, () => dismissUsdc.mutateAsync(transactionId))}
              onCashFromWallet={(transactionId) => answer(q.id, () => fromWallet.mutateAsync(transactionId))}
              onCashCard={(transactionId, reply) => answer(q.id, () => cashCard.mutateAsync({ id: transactionId, answer: reply }))}
              onPayWith={(paymentId, transactionId) => answer(q.id, () => payWith.mutateAsync({ paymentId, transactionIds: [transactionId] }))}
              onNotPaidBy={(paymentId, transactionId) => answer(q.id, () => notPaidBy.mutateAsync({ paymentId, transactionId }))}
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
          {arriving && (
            <UsdcArrivedSheet
              eventId={arriving.eventId}
              expectedAmount={arriving.expectedAmount}
              onClose={() => setArriving(null)}
              onSaved={() => {
                // The same ending as a one-tap answer: the last card closes the list too.
                if (questions.length <= 1) closeIfOpen("questions");
                hide(arriving.id, true);
              }}
            />
          )}
        </Sheet>
      )}
      {sheet === "subscriptions" && subscriptions && (
        <SubscriptionsSheet
          subscriptions={subscriptions}
          onClose={closeSheet}
          onDismiss={() => {
            closeSheet();
            dismissObservation.mutate({ kind: "subscriptions", category: null });
          }}
        />
      )}
      {paying && <PaymentPaidSheet payment={paying} today={data.date} onClose={() => setPaying(null)} />}
    </View>
  );
}

/** Tells the server, once a day, that the phrase showed this observation: from then on it is today's. */
function MarkShown({ date, which, mark }: { date: string; which: ObservationRef; mark: ReturnType<typeof useMarkObservationShown> }) {
  // `mark` is new on each render and keeps its own once-a-day memory: the observation is what the effect follows.
  useEffect(() => mark(date, which), [date, which.kind, which.category]);
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  date: { ...type.label, color: color.fg.default, flexShrink: 1 },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.glass.row },
  heroPress: { minHeight: touchMin },
  hero: { overflow: "hidden", borderRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg, gap: 2 },
  bar: { marginTop: space.md },
  spentLine: { marginTop: space.xs },
  phraseRow: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.xs },
  phrase: { ...type.body, color: color.fg.default },
  paceRow: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  paceText: { ...type.body, color: color.limit.low, flex: 1 },
  runway: { marginTop: space.sm },
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
  planRow: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xs },
  planText: { ...type.body, color: color.fg.default, flex: 1 },
  planAmount: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  amount: { ...type.amount, lineHeight: LAYOUT.amount, color: color.fg.default, fontVariant: ["tabular-nums"] },
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
