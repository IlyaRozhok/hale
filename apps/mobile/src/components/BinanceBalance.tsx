import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { tokens } from "@tablo/tokens";
import type { TodayDto } from "@tablo/contracts";
import { TODAY_KEY, useManualBalances, useSaveBinanceBalance } from "../api/queries";
import { formatMoney, formatOriginal, parseBalance } from "../format";
import { Chip } from "./Chip";
import { Field } from "./Field";
import { Glass } from "./Glass";

const { color, space, type } = tokens;

/** The USDC on Binance as the app counts it. The bank does not see it, so the owner can correct it here. */
export function BinanceBalance() {
  const balances = useManualBalances();
  // The rate Today already loaded; hryvnias are left out until it has.
  const usdRate = useQueryClient().getQueryData<TodayDto>(TODAY_KEY)?.usdRate ?? 0;
  const save = useSaveBinanceBalance();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const current = balances.data?.find((b) => b.name === "Binance");

  const submit = () => {
    const cents = parseBalance(amount);
    if (cents === null) {
      setMessage("Проверьте сумму.");
      return;
    }
    setMessage(null);
    save.mutate(
      { id: current?.id ?? null, amount: cents },
      {
        onSuccess: () => {
          setAmount("");
          setMessage("Баланс сохранён.");
        },
        onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз."),
      },
    );
  };

  return (
    <Glass style={styles.stack}>
      <Text style={styles.heading}>Баланс Binance</Text>
      {balances.isError && <Text style={styles.muted}>Не получилось загрузить баланс.</Text>}
      {balances.data && (
        <Text style={styles.text}>
          {current ? formatOriginal(current.amount, current.currency) : "Баланс не задан"}
          {current && usdRate > 0 ? `, ${formatMoney(current.amount * usdRate)}` : ""}
        </Text>
      )}
      <Field label="Новый баланс Binance, $" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {message && <Text style={styles.text}>{message}</Text>}
      <Chip label="Сохранить баланс" selected disabled={save.isPending || !balances.data} onPress={submit} />
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  heading: { ...type.title, color: color.fg.default },
  text: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  muted: { ...type.body, color: color.fg.muted },
});
