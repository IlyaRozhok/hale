import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullRefresh } from "../usePullRefresh";
import { tokens } from "@hale/tokens";
import { useCash, useExpectedIncomes, useGoals, useIncomeEvents, useLoanHistory, useManualBalances, usePayments, useToday } from "../api/queries";
import { AccountLines } from "../components/AccountsList";
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
import { PlanGroup } from "../components/PlanGroup";
import { TaxSheet } from "../components/TaxPayments";
import { formatDollars, formatMoney } from "../format";
import { goalsLine, incomesLine, installmentsLine, paymentsLine, taxLine } from "../planSummary";

const { color, radius, space, touchMin, type } = tokens;

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

  const binance = balances.data?.find((b) => b.name === "Binance");
  const stillOpen = history.data?.stats.stillOpen;

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
          { label: "Наличные", detail: cash.data ? (cash.data.started ? formatMoney(cash.data.balance) : "не начат") : undefined, onPress: () => setOpen("cash") },
          { label: "Binance", detail: balances.data ? (binance ? formatDollars(binance.amount) : "не задан") : undefined, onPress: () => setOpen("binance") },
        ]}
      >
        {today.data ? <AccountLines accounts={today.data.accounts} /> : null}
      </PlanGroup>
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
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.glass.row },
});
