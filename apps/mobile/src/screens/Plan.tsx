import { useState } from "react";
import type { ManualBalanceDto, OwnMoneyItemDto } from "@hale/contracts";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullRefresh } from "../usePullRefresh";
import { tokens } from "@hale/tokens";
import { useCash, useExpectedIncomes, useGoals, useIncomeEvents, useLoanHistory, useManualBalances, usePayments, useToday } from "../api/queries";
import { AccountSheet, NewAccountSheet } from "../components/AccountSheet";
import { AccountLines, OwnMoney } from "../components/AccountsList";
import { BinanceSheet } from "../components/BinanceBalance";
import { CashSheet } from "../components/CashSheet";
import { Icon } from "../components/Icon";
import { Settings } from "./Settings";
import { GoalsSheet } from "../components/GoalsSection";
import { LAYOUT } from "../components/layout";
import { IncomesSheet } from "../components/IncomesSheet";
import { InstallmentsSheet } from "../components/InstallmentsSheet";
import { LoansSheet } from "../components/LoansSheet";
import { PaymentsSheet } from "../components/PaymentsSheet";
import { PlanGroup, type PlanRow } from "../components/PlanGroup";
import { SetAsideSheet } from "../components/SetAsideSheet";
import { TaxSheet } from "../components/TaxPayments";
import { formatDollars, formatMoney, formatOriginal } from "../format";
import { placeName, placeOpens, setAsideDetail } from "../ownMoney";
import { goalsLine, incomesLine, installmentsLine, paymentsLine, taxLine } from "../planSummary";

const { color, radius, space, touchMin, type } = tokens;

/** A balance kept by hand in its own currency: whole dollars like the rest of the plan, others with cents. */
function balanceDetail(b: ManualBalanceDto): string {
  return b.currency === "USD" ? formatDollars(b.amount) : formatOriginal(b.amount, b.currency);
}

type Part = "incomes" | "payments" | "installments" | "tax" | "loans" | "goals" | "binance" | "cash" | "settings";

/** Where the money stands, then one line per part of the plan; the details and forms open in windows. */
export function Plan() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const pull = usePullRefresh(today.refetch);
  const incomes = useExpectedIncomes();
  const events = useIncomeEvents();
  const payments = usePayments();
  const history = useLoanHistory();
  const goals = useGoals();
  const balances = useManualBalances();
  const cash = useCash();
  const [open, setOpen] = useState<Part | null>(null);
  const close = () => setOpen(null);
  // A set-aside balance being opened, or "new" for adding one.
  const [aside, openAside] = useState<ManualBalanceDto | "new" | null>(null);
  // A place of money whose account window is open (Д2б), with its amount as its row shows it, or "new" for «Новый счёт».
  const [account, openAccount] = useState<{ item: OwnMoneyItemDto; amount: string } | "new" | null>(null);

  const binance = balances.data?.find((b) => b.name === "Binance");
  const stillOpen = history.data?.stats.stillOpen;
  // Money set aside (a coin, a deposit) stays out of own money and the limit: its own group below «Деньги».
  const setAsideBalances = balances.data?.filter((b) => !b.counts_as_own) ?? [];
  // A newer server (Д2а) lists what is set aside itself, switched-off bank accounts included: then every place opens
  // the account window and «Добавить счёт» adds one. With an older server the screen stays as it was.
  const setAside = today.data?.accounts.setAside;
  // Not before «Сегодня» is known, or the old group would show and then go away.
  const older = !today.isPending && setAside === undefined;
  // With nothing set aside there is no group, only one quiet part folded into «Ещё» of «Деньги» (older server).
  const noSetAside: PlanRow[] =
    older && balances.data && setAsideBalances.length === 0 ? [{ label: "Отложено", detail: "нет", onPress: () => openAside("new") }] : [];
  // A newer server lists own money place by place (task Б25): cash and Binance with money in them are
  // places in that list, not rows of their own; an unstarted wallet or an unset Binance stays a row.
  const items = today.data?.accounts.items;
  const placed = (kind: "cash" | "binance") => [...(items ?? []), ...(setAside ?? [])].some((i) => i.kind === kind);
  const asideRow = (item: OwnMoneyItemDto, i: number): PlanRow => {
    const detail = setAsideDetail(item);
    const opens = placeOpens(item);
    const onPress =
      opens === "binance" ? () => setOpen("binance") : opens === "account" || opens === "manual" ? () => openAccount({ item, amount: detail }) : () => undefined;
    return { key: `${item.source ?? item.kind}:${item.id ?? i}`, label: placeName(item), detail, onPress };
  };
  const cashRow: PlanRow = { label: "Наличные", detail: cash.data ? (cash.data.started ? formatMoney(cash.data.balance) : "не начат") : undefined, onPress: () => setOpen("cash") };
  const binanceRow: PlanRow = { label: "Binance", detail: balances.data ? (binance ? formatDollars(binance.amount) : "не задан") : undefined, onPress: () => setOpen("binance") };

  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: LAYOUT.tabBar + insets.bottom }]}
      refreshControl={<RefreshControl {...pull} />}
    >
      <View style={styles.head}>
        <Text style={styles.title}>План</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => setOpen("settings")} style={styles.profile}>
          <Icon name="user" color={color.fg.muted} size={20} />
        </Pressable>
      </View>
      <PlanGroup
        title="Деньги"
        rows={[
          // Not before «Сегодня» is known, or they would show and then go into the list; on an error they stay.
          ...(today.isPending || placed("cash") ? [] : [cashRow]),
          ...(today.isPending || placed("binance") ? [] : [binanceRow]),
          ...noSetAside,
        ]}
      >
        {today.data && items ? (
          <OwnMoney
            own={today.data.accounts.own}
            items={items}
            onCash={() => setOpen("cash")}
            onBinance={() => setOpen("binance")}
            onAccount={(item, amount) => openAccount({ item, amount })}
          />
        ) : today.data ? (
          <AccountLines accounts={today.data.accounts} />
        ) : null}
      </PlanGroup>
      {setAside !== undefined && setAside.length > 0 && <PlanGroup title="Отложено" rows={setAside.map(asideRow)} />}
      {setAside !== undefined && (
        <Pressable accessibilityRole="button" accessibilityLabel="Добавить счёт" onPress={() => openAccount("new")} style={styles.add}>
          <Text style={styles.addText}>Добавить счёт</Text>
        </Pressable>
      )}
      {older && setAsideBalances.length > 0 && (
        <PlanGroup
          title="Отложено"
          rows={setAsideBalances.map((b) => ({ key: String(b.id), label: b.name, detail: balanceDetail(b), onPress: () => openAside(b) }))}
          action={{ text: "+ Добавить", a11y: "Добавить в отложенное", onPress: () => openAside("new") }}
        />
      )}
      <PlanGroup
        title="Приходит"
        rows={[{ label: "Доходы", detail: incomes.data && events.data ? incomesLine(incomes.data, events.data) : undefined, onPress: () => setOpen("incomes") }]}
      />
      <PlanGroup
        title="Уходит"
        rows={[
          { label: "Платежи", detail: payments.data ? paymentsLine(payments.data) : undefined, onPress: () => setOpen("payments") },
          { label: "Рассрочки", detail: payments.data ? installmentsLine(payments.data, today.data?.usdRate) : undefined, onPress: () => setOpen("installments") },
          { label: "Налоги", detail: payments.data ? taxLine(payments.data) : undefined, onPress: () => setOpen("tax") },
          { label: "Займы", detail: stillOpen === undefined ? undefined : stillOpen > 0 ? `открыто ${formatMoney(stillOpen)}` : "открытых нет", onPress: () => setOpen("loans") },
        ]}
      />
      <PlanGroup title="Копится" rows={[{ label: "Цели", detail: goals.data ? goalsLine(goals.data) : undefined, onPress: () => setOpen("goals") }]} />
      {open === "incomes" && <IncomesSheet onClose={close} />}
      {open === "payments" && <PaymentsSheet onClose={close} />}
      {open === "installments" && <InstallmentsSheet onClose={close} />}
      {open === "tax" && <TaxSheet onClose={close} />}
      {open === "loans" && <LoansSheet onClose={close} />}
      {open === "goals" && <GoalsSheet onClose={close} />}
      {open === "binance" && <BinanceSheet onClose={close} />}
      {open === "cash" && <CashSheet onClose={close} />}
      {account === "new" && <NewAccountSheet onClose={() => openAccount(null)} />}
      {account !== null && account !== "new" && <AccountSheet item={account.item} amount={account.amount} onClose={() => openAccount(null)} />}
      {aside !== null && <SetAsideSheet balance={aside === "new" ? undefined : aside} onClose={() => openAside(null)} />}
      {open === "settings" && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
          <Settings onClose={close} />
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  // Lines up with the text inside the panels below it.
  title: { ...type.title, color: color.fg.default, paddingHorizontal: space.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // A quiet text link under «Отложено», as in the mockup, with no card of its own; it lines up with the text in the panels.
  add: { minHeight: touchMin, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.lg, marginTop: -space.sm },
  addText: { ...type.label, color: color.fg.muted },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.glass.row },
});
