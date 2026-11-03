import { RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { useToday } from "../api/queries";
import { AccountsList } from "../components/AccountsList";
import { BinanceBalance } from "../components/BinanceBalance";
import { GoalsSection } from "../components/GoalsSection";
import { ManualLoan } from "../components/ManualLoan";
import { TaxPayments } from "../components/TaxPayments";

const { color, space, type } = tokens;

/** Money, goals and everything the owner keeps by hand. */
export function Plan() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  return (
    <ScrollView
      style={[styles.root, { marginTop: insets.top }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={today.isRefetching && !today.isPending} onRefresh={() => void today.refetch()} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>План</Text>
      {today.data ? <AccountsList title="Деньги" accounts={today.data.accounts} usdRate={today.data.usdRate} /> : null}
      <GoalsSection />
      <BinanceBalance />
      <TaxPayments />
      <ManualLoan />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base },
  content: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  title: { ...type.title, color: color.fg.default },
});
