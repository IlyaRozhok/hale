import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullRefresh } from "../usePullRefresh";
import { tokens } from "@hale/tokens";
import { useExpectedIncomes, useGoals, useIncomeEvents, useLoanHistory, useManualBalances, usePayments, useToday } from "../api/queries";
import { AccountsList } from "../components/AccountsList";
import { BinanceSheet } from "../components/BinanceBalance";
import { Glass } from "../components/Glass";
import { GoalsSheet } from "../components/GoalsSection";
import { LAYOUT } from "../components/layout";
import { IncomesSheet } from "../components/IncomesSheet";
import { InstallmentsSheet } from "../components/InstallmentsSheet";
import { LoansSheet } from "../components/LoansSheet";
import { PaymentsSheet } from "../components/PaymentsSheet";
import { SummaryRow } from "../components/SummaryRow";
import { TaxSheet } from "../components/TaxPayments";
import { formatDollars, formatMoney } from "../format";
import { goalsLine, incomesLine, installmentsLine, paymentsLine, taxLine } from "../planSummary";

const { color, space, type } = tokens;

type Part = "incomes" | "payments" | "installments" | "tax" | "loans" | "goals" | "binance";

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
  const [open, setOpen] = useState<Part | null>(null);
  const close = () => setOpen(null);

  const binance = balances.data?.find((b) => b.name === "Binance");
  const stillOpen = history.data?.stats.stillOpen;

  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: LAYOUT.tabBar + insets.bottom }]}
      refreshControl={<RefreshControl {...pull} />}
    >
      <Text style={styles.title}>План</Text>
      {today.data ? <AccountsList title="Деньги" accounts={today.data.accounts} usdRate={today.data.usdRate} /> : null}
      <Glass>
        <SummaryRow label="Доходы" detail={incomes.data && events.data ? incomesLine(incomes.data, events.data) : undefined} onPress={() => setOpen("incomes")} />
        <SummaryRow label="Платежи" detail={payments.data ? paymentsLine(payments.data) : undefined} onPress={() => setOpen("payments")} />
        <SummaryRow label="Рассрочки" detail={payments.data ? installmentsLine(payments.data, today.data?.usdRate ?? 0) : undefined} onPress={() => setOpen("installments")} />
        <SummaryRow label="Налоги" detail={payments.data ? taxLine(payments.data) : undefined} onPress={() => setOpen("tax")} />
        <SummaryRow label="Займы" detail={stillOpen === undefined ? undefined : stillOpen > 0 ? `открыто ${formatMoney(stillOpen)}` : "открытых нет"} onPress={() => setOpen("loans")} />
        <SummaryRow label="Цели" detail={goals.data ? goalsLine(goals.data) : undefined} onPress={() => setOpen("goals")} />
        <SummaryRow label="Binance" detail={balances.data ? (binance ? formatDollars(binance.amount) : "не задан") : undefined} onPress={() => setOpen("binance")} />
      </Glass>
      {open === "incomes" && <IncomesSheet onClose={close} />}
      {open === "payments" && <PaymentsSheet onClose={close} />}
      {open === "installments" && <InstallmentsSheet onClose={close} />}
      {open === "tax" && <TaxSheet onClose={close} />}
      {open === "loans" && <LoansSheet onClose={close} />}
      {open === "goals" && <GoalsSheet onClose={close} />}
      {open === "binance" && <BinanceSheet onClose={close} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  // Lines up with the text inside the panels below it.
  title: { ...type.title, color: color.fg.default, paddingHorizontal: space.lg },
});
