import { useState, type ReactNode } from "react";
import type { ManualBalanceDto, OwnMoneyItemDto } from "@hale/contracts";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullRefresh } from "../usePullRefresh";
import { tokens } from "@hale/tokens";
import { useCash, useExpectedIncomes, useGoals, useIncomeEvents, useLoanHistory, useManualBalances, usePayments, useRecurring, useToday } from "../api/queries";
import { AccountSheet, NewAccountSheet } from "../components/AccountSheet";
import { AsideSheet } from "../components/AsideSheet";
import { BinanceSheet } from "../components/BinanceBalance";
import { CashSheet } from "../components/CashSheet";
import { Icon, type IconName } from "../components/Icon";
import { Settings } from "./Settings";
import { GoalsSheet } from "../components/GoalsSection";
import { LAYOUT } from "../components/layout";
import { IncomesSheet } from "../components/IncomesSheet";
import { InstallmentsSheet } from "../components/InstallmentsSheet";
import { LoansSheet } from "../components/LoansSheet";
import { PaymentsSheet } from "../components/PaymentsSheet";
import { DateRow, ListRow, PlanSection } from "../components/PlanList";
import { SetAsideSheet } from "../components/SetAsideSheet";
import { TaxSheet } from "../components/TaxPayments";
import { formatDollars, formatMoney, formatOriginal } from "../format";
import { placeName, placeNote, placeOpens, setAsideDetail, setAsideTotal, wholeShares } from "../ownMoney";
import { incomeOnDay, installmentGroups, moneyIn, paymentsCount, taxesShown, unpaidTaxCount } from "../planSummary";

const { color, space, touchMin, type } = tokens;

/** A balance kept by hand in its own currency: whole dollars like the rest of the plan, others with cents. */
function balanceDetail(b: ManualBalanceDto): string {
  return b.currency === "USD" ? formatDollars(b.amount) : formatOriginal(b.amount, b.currency);
}

/** A short count on the right of a part; nothing when there is nothing, rather than a word. */
const count = (n: number | undefined): string | undefined => (n ? String(n) : undefined);

function placeIcon(item: OwnMoneyItemDto): IconName {
  if (item.kind === "cash") return "cash";
  if (item.kind === "binance") return "coin";
  return item.source === "manual" || item.kind === "manual" ? "lock" : "card";
}

type Part = "incomes" | "payments" | "installments" | "tax" | "loans" | "goals" | "binance" | "cash" | "settings";

/**
 * «План» as an iOS list (variant А, the owner's «Оба А» of 22 November): own money at the top, what happens before the
 * income by date, the accounts with «Отложено» as one row, and the parts of the plan that open their windows.
 */
export function Plan() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const pull = usePullRefresh(today.refetch);
  const incomes = useExpectedIncomes();
  const events = useIncomeEvents();
  const payments = usePayments();
  const recurring = useRecurring();
  const history = useLoanHistory();
  const goals = useGoals();
  const balances = useManualBalances();
  const cash = useCash();
  const [open, setOpen] = useState<Part | null>(null);
  const close = () => setOpen(null);
  // The «Отложено» window: the set-aside places, the empty ones, and adding one more.
  const [asideOpen, setAsideOpen] = useState(false);
  // A set-aside balance of an older server being opened, or "new" for adding one.
  const [balance, openBalance] = useState<ManualBalanceDto | "new" | null>(null);
  // A place of money whose account window is open (Д2б), with its amount as its row shows it, or "new" for «Новый счёт».
  const [account, openAccount] = useState<{ item: OwnMoneyItemDto; amount: string } | "new" | null>(null);

  const data = today.data;
  const binance = balances.data?.find((b) => b.name === "Binance");
  const stillOpen = history.data?.stats.stillOpen;
  // A newer server (Д2а) lists what is set aside itself; with an older one the set-aside balances kept by hand stand
  // in «Отложено» as they did, each opening its own window.
  const setAside = data?.accounts.setAside;
  // Not before «Сегодня» is known, or the rows would show and then move.
  const older = !today.isPending && setAside === undefined;
  const setAsideBalances = balances.data?.filter((b) => !b.counts_as_own) ?? [];
  // A newer server lists own money place by place (task Б25): cash and Binance with money in them are places in that
  // list, not rows of their own; an unstarted wallet or an unset Binance stays a row.
  const items = data?.accounts.items;
  const placed = (kind: "cash" | "binance") => [...(items ?? []), ...(setAside ?? [])].some((i) => i.kind === kind);

  const placeRow = (item: OwnMoneyItemDto, amount: string, key: string) => {
    const opens = placeOpens(item);
    const onPress =
      opens === "cash" ? () => setOpen("cash") : opens === "binance" ? () => setOpen("binance") : opens === null ? undefined : () => openAccount({ item, amount });
    // A set-aside balance in dollars already shows them as its amount: no second line saying the same.
    const note = placeNote(item);
    return <ListRow key={key} icon={placeIcon(item)} label={placeName(item)} subtitle={note === amount ? null : note} value={amount} onPress={onPress} />;
  };
  const keyOf = (item: OwnMoneyItemDto, i: number) => `${item.source ?? item.kind}:${item.id ?? i}`;

  // Places with money, those in credit last, rounded together so they add up to own money to the hryvnia. A place with
  // nothing on it moves into «Отложено» (on a server that lists it; otherwise it stays in «Счета»).
  const withMoney = items ? [...items.filter((i) => i.own > 0), ...items.filter((i) => i.own < 0)] : [];
  const empty = items?.filter((i) => i.own === 0) ?? [];
  const whole = data ? wholeShares(data.accounts.own, withMoney.map((i) => i.own)) : [];

  // Not before «Сегодня» is known, or they would show and then go into the list; on an error they stay.
  const cashRow =
    today.isPending || placed("cash") ? null : (
      <ListRow key="cash" icon="cash" label="Наличные" value={cash.data ? (cash.data.started ? formatMoney(cash.data.balance) : "не начат") : undefined} onPress={() => setOpen("cash")} />
    );
  const binanceRow =
    today.isPending || placed("binance") ? null : (
      <ListRow key="binance" icon="coin" label="Binance" value={balances.data ? (binance ? formatDollars(binance.amount) : "не задан") : undefined} onPress={() => setOpen("binance")} />
    );

  let accounts: ReactNode[] = [];
  let asideRows: ReactNode[] = [];
  if (data && items) accounts = withMoney.map((item, i) => placeRow(item, formatMoney(whole[i]! * 100), keyOf(item, i)));
  else if (data) {
    // An older server without places: own money is the figure above, credit money a row of its own (a limit, not a balance).
    if (data.accounts.fop !== 0) accounts.push(<ListRow key="fop" label="в том числе ФОП" value={formatMoney(data.accounts.fop)} />);
    accounts.push(<ListRow key="credit" icon="card" label="Кредитные" value={formatMoney(data.accounts.credit)} />);
  }
  if (older) {
    // No «Отложено» list from this server: a place at zero (a started wallet at ₴0, Binance at $0) stays a row here.
    accounts.push(...empty.map((item, i) => placeRow(item, formatMoney(0), `empty:${keyOf(item, i)}`)), cashRow, binanceRow);
    asideRows = setAsideBalances.map((b) => <ListRow key={`b${b.id}`} icon="lock" label={b.name} value={balanceDetail(b)} onPress={() => openBalance(b)} />);
  } else if (setAside) {
    asideRows = [
      ...setAside.map((item, i) => placeRow(item, setAsideDetail(item), `aside:${keyOf(item, i)}`)),
      ...empty.map((item, i) => placeRow(item, formatMoney(0), `empty:${keyOf(item, i)}`)),
      cashRow,
      binanceRow,
    ];
  }
  const asideTotal = setAsideTotal(setAside);
  const addAside = older
    ? { label: "Добавить в отложенное", onPress: () => openBalance("new") }
    : { label: "Добавить счёт", onPress: () => openAccount("new") };

  // «До дохода»: the unpaid payments the runway knows, by date, then the income on its day. Not without an income date.
  const runway = data?.runway;
  const incomeOn = runway?.incomeOn ?? null;
  const income = incomeOn && incomes.data && events.data ? incomeOnDay(incomes.data, events.data, incomeOn) : undefined;
  const beforeIncome = runway && incomeOn ? [...runway.events].sort((a, b) => a.date.localeCompare(b.date)) : [];

  // Not before «Сегодня» is known, or a person without taxes would see «Налоги» come and go (Д4).
  const taxes = !today.isPending && taxesShown(data?.taxes, payments.data);
  const openLoans = history.data ? history.data.open.length + history.data.old.length : undefined;

  // Windows opened from a row: inside «Отложено» when they were opened from it, so they show over it.
  const windows = (
    <>
      {open === "binance" && <BinanceSheet onClose={close} />}
      {open === "cash" && <CashSheet onClose={close} />}
      {account === "new" && <NewAccountSheet onClose={() => openAccount(null)} />}
      {account !== null && account !== "new" && <AccountSheet item={account.item} amount={account.amount} onClose={() => openAccount(null)} />}
      {balance !== null && <SetAsideSheet balance={balance === "new" ? undefined : balance} onClose={() => openBalance(null)} />}
    </>
  );

  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: LAYOUT.tabBar + insets.bottom }]}
      refreshControl={<RefreshControl {...pull} />}
    >
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => setOpen("settings")} style={styles.gear}>
          <Icon name="settings" color={color.fg.muted} size={22} />
        </Pressable>
      </View>
      <Text style={styles.title}>План</Text>
      {data && (
        <View style={styles.hero}>
          <Text style={styles.caption}>Свои деньги</Text>
          <Text style={styles.own}>{formatMoney(data.accounts.own)}</Text>
        </View>
      )}
      {runway && incomeOn && (
        <PlanSection title="До дохода" footer="Что после дохода — в разделах ниже.">
          {beforeIncome.map((e) => (
            <DateRow key={`e${e.id}:${e.date}`} date={e.date} label={e.name} value={formatMoney(-e.amount)} />
          ))}
          <DateRow key="income" date={incomeOn} label={income?.name ?? "Доход"} value={income ? `+${moneyIn(income.amount, income.currency)}` : undefined} income />
        </PlanSection>
      )}
      {!today.isPending && (
        <PlanSection title="Счета">
          {accounts}
          <ListRow key="aside" icon="lock" label="Отложено" subtitle="не входит в свои деньги" value={asideTotal} onPress={() => setAsideOpen(true)} />
        </PlanSection>
      )}
      <PlanSection title="Разделы">
        <ListRow key="incomes" icon="arrowDown" label="Доходы" value={count(incomes.data?.length)} quiet onPress={() => setOpen("incomes")} />
        <ListRow
          key="payments"
          icon="calendar"
          label="Платежи"
          value={payments.data && recurring.data ? count(paymentsCount(recurring.data, payments.data)) : undefined}
          quiet
          onPress={() => setOpen("payments")}
        />
        <ListRow key="installments" icon="repeat" label="Рассрочки" value={payments.data ? count(installmentGroups(payments.data).length) : undefined} quiet onPress={() => setOpen("installments")} />
        {taxes && <ListRow key="tax" icon="receipt" label="Налоги" value={payments.data ? count(unpaidTaxCount(payments.data)) : undefined} quiet onPress={() => setOpen("tax")} />}
        {/* Always there: its window is also where a loan is added by hand. The count only while one is open. */}
        <ListRow key="loans" icon="transfer" label="Займы" value={stillOpen !== undefined && stillOpen > 0 ? count(openLoans) : undefined} quiet onPress={() => setOpen("loans")} />
        <ListRow key="goals" icon="flag" label="Цели" value={count(goals.data?.length)} quiet onPress={() => setOpen("goals")} />
      </PlanSection>
      {open === "incomes" && <IncomesSheet onClose={close} />}
      {open === "payments" && <PaymentsSheet onClose={close} />}
      {open === "installments" && <InstallmentsSheet onClose={close} />}
      {open === "tax" && <TaxSheet onClose={close} />}
      {open === "loans" && <LoansSheet onClose={close} />}
      {open === "goals" && <GoalsSheet onClose={close} />}
      {asideOpen ? (
        <AsideSheet rows={asideRows} add={addAside} onClose={() => setAsideOpen(false)}>
          {windows}
        </AsideSheet>
      ) : (
        windows
      )}
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
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.lg },
  // The gear sits alone in the top right corner, over the large title, as in iOS.
  bar: { flexDirection: "row", justifyContent: "flex-end", marginBottom: -space.lg },
  gear: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  // Large titles and the hero line up with the text inside the cards below them.
  title: { ...type.display, color: color.fg.default, paddingHorizontal: space.xs },
  hero: { paddingHorizontal: space.xs, marginTop: -space.sm },
  caption: { ...type.body, color: color.fg.muted },
  own: { ...type.amount, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
