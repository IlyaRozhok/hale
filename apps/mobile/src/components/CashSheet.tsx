import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { useCash, useCountCash } from "../api/queries";
import { formatMoney, parseBalance, shortDate } from "../format";
import { CashStartForm } from "./CashStartForm";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, type } = tokens;

/** The wallet: what is recorded, and "Пересчитал" to match it to the pocket. */
export function CashSheet({ onClose }: { onClose: () => void }) {
  const cash = useCash();
  const count = useCountCash();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const w = cash.data;

  const counted = parseBalance(amount);
  const effect =
    !w || counted === null || counted === w.balance
      ? null
      : counted < w.balance
        ? // The server writes it on today but outside the day's limit (Б47 (2)).
          `${formatMoney(w.balance - counted)} запишется как «Не записано» за сегодня. Лимит дня не изменится.`
        : `Остаток станет больше на ${formatMoney(counted - w.balance)}, лимит не изменится.`;

  const save = () => {
    if (counted === null) {
      setMessage("Введите сумму, можно 0.");
      return;
    }
    setMessage(null);
    count.mutate(counted, { onSuccess: () => setAmount(""), onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") });
  };

  return (
    <Sheet title="Наличные" onClose={onClose}>
      {w && !w.started && <CashStartForm />}
      {w?.started && (
        <>
          <Text style={styles.text}>{`По записям ${formatMoney(w.balance)}, учёт с ${shortDate(w.start!)}`}</Text>
          <Text style={styles.muted}>Пересчитайте наличные и введите, сколько на самом деле.</Text>
          <Field label="Сколько в кармане" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          {effect && <Text style={styles.text}>{effect}</Text>}
          {message && <ErrorText>{message}</ErrorText>}
          <PrimaryButton label="Пересчитал" disabled={count.isPending} onPress={save} />
        </>
      )}
      {cash.isError && <ErrorText>Не получилось загрузить. Проверьте связь и попробуйте ещё раз.</ErrorText>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
});
