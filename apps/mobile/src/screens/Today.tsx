import { useCallback, useEffect, useState } from "react";
import { Modal, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { shiftDate } from "../format";
import { dayPhrase, type PhraseAction } from "../dayPhrase";
import {
  useCalendar,
  useCategoryList,
  useDismissObservation,
  useInsights,
  useMarkObservationShown,
  useObservation,
  useToday,
} from "../api/queries";
import { PaymentPaidSheet } from "../components/PaymentPaidSheet";
import { BadCaseCard } from "../components/BadCaseCard";
import { LAYOUT } from "../components/layout";
import { LimitCalendar } from "../components/LimitCalendar";
import { LoansSheet } from "../components/LoansSheet";
import { PaceSheet } from "../components/PaceSheet";
import { SubscriptionsSheet } from "../components/SubscriptionsSheet";
import { TodaySkeleton } from "../components/TodaySkeleton";
import { BridgePlanRow } from "../components/today/BridgePlanRow";
import { BridgeSheet } from "../components/today/BridgeSheet";
import { DayPhraseRow } from "../components/today/DayPhraseRow";
import { Freshness } from "../components/today/Freshness";
import { LimitCard, isOverLimit } from "../components/today/LimitCard";
import { LimitSheet } from "../components/today/LimitSheet";
import { LoadError } from "../components/today/LoadError";
import { MonthSection } from "../components/today/MonthSection";
import { PaymentsSection } from "../components/today/PaymentsSection";
import { QuestionsSheet, openQuestions } from "../components/today/QuestionsSheet";
import { TodayHeader, TodayHeaderProfileOnly } from "../components/today/TodayHeader";
import { UntilIncomeCard } from "../components/today/UntilIncomeCard";
import { limitSheet } from "../limitSheet";
import { usePullRefresh } from "../usePullRefresh";
import { Settings } from "./Settings";

const { space } = tokens;
type Props = {
  /** Opens the operations; with a date, those of that one day. */
  onOpenActivity: (day?: string) => void;
  /** Opens the operations on the category and days of the phrase's observation (task В7). */
  onOpenObservation?: (category: string, from: string, to: string) => void;
  /** Opens the «План» tab, from «Ещё N» under the payments (task ЧЛ6); without it that row is plain text. */
  onOpenPlan?: () => void;
  /** Opens the «Итоги» tab, from the header of the month (task ЧЛ7); without it that header is plain text. */
  onOpenInsights?: () => void;
  /** Test seam for the current moment. */
  now?: () => Date;
};

/**
 * «Сегодня», the shell: the data hooks, the state several sections share (which sheet is open, the answers hidden
 * while their call runs, the payment being marked paid, the settings) and the figures more than one section reads.
 * Each section lives in its own file in `components/today/` and says its contract there.
 */
export function Today({ onOpenActivity, onOpenObservation, onOpenPlan, onOpenInsights, now = () => new Date() }: Props) {
  const insets = useSafeAreaInsets();
  const today = useToday();
  // «Итоги» of the current month, for the month section (ЧЛ7) and the subscriptions' list of the phrase: one request
  // for both. The screen never waits for it: no answer, a failed one or an older server's is just no month section.
  const insights = useInsights();
  const refetchInsights = insights.refetch;
  // A pull asks for the month again as well; the spinner follows «Сегодня» alone.
  const refetchAll = useCallback(() => {
    void refetchInsights();
    return today.refetch();
  }, [refetchInsights, today.refetch]);
  const pull = usePullRefresh(refetchAll);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<"bridge" | "questions" | "calendar" | "loans" | "subscriptions" | "pace" | "limit" | null>(null);
  const [paying, setPaying] = useState<TodayDto["upcoming"][number] | null>(null);
  // Task ЯМ7 (the owner's «Все А»): settings open from the profile button in the header, not from «План».
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  const subscriptions = insights.data?.subscriptions ?? null;
  const top = insets.top + space.sm;
  const closeSheet = () => setSheet(null);
  /** Closes the sheet only if it is still the one open: a late answer must not close another. */
  const closeIfOpen = (name: "bridge" | "questions") => setSheet((s) => (s === name ? null : s));
  // Task Я9: once the server lists no questions (a refresh while the list is open), the list closes rather than stays
  // empty. Answers hidden here while their call runs do not count: a failed call brings its card back into the list.
  const listed = data ? openQuestions(data, new Set()).length : 0;
  useEffect(() => {
    if (listed === 0) closeIfOpen("questions");
  }, [listed]);
  const openSettings = () => setSettingsOpen(true);
  const settings = settingsOpen && (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsOpen(false)}>
      <Settings onClose={() => setSettingsOpen(false)} />
    </Modal>
  );

  if (!data) {
    return (
      <View style={styles.root}>
        <View style={[styles.content, { paddingTop: top }]}>
          {/* Settings, and «Выйти» with them, stay reachable when the data does not load. */}
          {today.isError && <TodayHeaderProfileOnly onOpenSettings={openSettings} />}
          {today.isError ? <LoadError onRetry={() => void today.refetch()} /> : <TodaySkeleton />}
        </View>
        {settings}
      </View>
    );
  }

  const { state } = data;
  const over = isOverLimit(state);
  // The day the shortage mode came on, while it still runs on the limit it began with: what is already spent
  // is not set against the new one. Once the day's limit is the new one the server names none for tomorrow.
  const nextLimit = state.shortageStart?.nextLimit;
  const offlineSince = today.isError ? today.dataUpdatedAt : null;
  const questions = openQuestions(data, answered);
  // Loans live in Plan: the server still lists each open one here, and Today leaves them out.
  const notes = data.badCases.filter((b) => !b.id.startsWith("loan:"));
  // Task А24: the sand line about the pace. The note that the minus went over the bridge plan already names the day
  // the money runs out, so with it on the screen the line is left out (loan notes are not shown here).
  const pace = data.pace && !notes.some((b) => b.id.startsWith("bridge_over_plan:")) ? data.pace : null;
  const runway = data.runway ?? null;
  // The limit the runway is drawn for: on the day the shortage came on it is tomorrow's new one, not the morning's (А23).
  const runwayLimit = nextLimit ?? state.dailyLimit;
  // Task ЧЛ4: what the limit is made of. Null from an older server (no `state.parts`) and with no limit: then the
  // limit section has no «Как посчитано» and its figure opens nothing.
  const limitParts = limitSheet(state, runway, data.date);
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
    // Tasks Я2, ЯМ1: on a hard day (the server sent the pace) or an overspent one the observation is not said, nor
    // marked shown. With the note that the minus went over the bridge plan the pace line is left out, but that note
    // carries the same bad news, so the day stays quiet.
    quiet: data.pace !== undefined || over,
  });
  /** «Оплачено» for a payment of `upcoming`; one it does not list opens nothing. */
  const pay = (id: string) => setPaying(data.upcoming.find((p) => p.id === id) ?? null);
  const act = (action: PhraseAction) => {
    if (action.kind === "pay") setPaying(action.payment);
    else if (action.kind === "observation") {
      const o = action.observation;
      // A spike shows where it came from; the subscriptions are still to come, so their list, not past operations.
      if (o.kind === "subscriptions") setSheet("subscriptions");
      else if (o.category !== null) onOpenObservation?.(o.category, o.from, o.to);
    } else setSheet(action.kind);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        testID="today-scroll"
        style={{ marginTop: insets.top }}
        contentContainerStyle={[styles.content, { paddingTop: space.sm, paddingBottom: LAYOUT.tabBar + insets.bottom }]}
        refreshControl={<RefreshControl {...pull} />}
      >
        <TodayHeader date={data.date} questions={questions.length} onOpenQuestions={() => setSheet("questions")} onOpenSettings={openSettings} />
        <Freshness data={data} offlineSince={offlineSince} now={now()} />
        <LimitCard state={state} streak={data.streak ?? 0} onOpenCalendar={() => setSheet("calendar")} onOpenParts={limitParts ? () => setSheet("limit") : undefined} />
        {phrase && <DayPhraseRow phrase={phrase} date={data.date} onAct={act} markShown={markShown} />}
        {state.mode === "bridge" && state.bridge?.confirmed && <BridgePlanRow dailyLimit={state.dailyLimit} onPress={() => setSheet("bridge")} />}

        {runway && (
          <UntilIncomeCard
            runway={runway}
            pace={pace}
            runwayLimit={runwayLimit}
            daysLeft={state.daysLeft}
            today={data.date}
            onOpenPace={() => setSheet("pace")}
            onPay={pay}
          />
        )}
        {/* Draws nothing without a runway (an older server), an income date or payments. */}
        <PaymentsSection runway={runway} upcoming={data.upcoming} today={data.date} onPay={pay} onOpenPlan={onOpenPlan} />
        {notes.map((b) => (
          <BadCaseCard key={b.id} text={b.text} />
        ))}
        {/*
          The month comes last, under the notes: a note is a warning and stays where it was, right under the payments.
          Draws nothing without «Итоги» (loading, failed, an older server) or in a month with nothing spent.
        */}
        <MonthSection insights={insights.data} categories={categories} onOpenInsights={onOpenInsights} />
      </ScrollView>

      {/* A loan to return opens the same list as in Plan (task Б7). */}
      {sheet === "loans" && <LoansSheet onClose={closeSheet} />}
      {sheet === "pace" && pace && <PaceSheet pace={pace} dailyLimit={runwayLimit} reserve={runway?.reserve ?? null} today={data.date} onClose={closeSheet} />}
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
      {sheet === "limit" && limitParts && (
        // The line about the plan leads to the plan's own sheet, which takes this one's place.
        <LimitSheet sheet={limitParts} onClose={closeSheet} onOpenPlan={state.bridge ? () => setSheet("bridge") : undefined} />
      )}
      <BridgeSheet open={sheet === "bridge"} data={data} onClose={closeSheet} onDone={() => closeIfOpen("bridge")} />
      <QuestionsSheet
        open={sheet === "questions"}
        questions={questions}
        today={data.date}
        onHide={hide}
        onClose={closeSheet}
        onLastAnswered={() => closeIfOpen("questions")}
        onOpenActivity={() => onOpenActivity()}
      />
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
      {settings}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.xl, gap: space.md },
});
