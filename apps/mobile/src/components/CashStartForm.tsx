import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { useStartCash } from "../api/queries";
import { parseBalance } from "../format";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";

const { color, type } = tokens;

/** Starting the wallet: what is in the pocket now. From today withdrawals stop spending the limit. */
export function CashStartForm() {
  const start = useStartCash();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const kopecks = parseBalance(amount);
    if (kopecks === null) {
      setMessage("Введите сумму, можно 0.");
      return;
    }
    setMessage(null);
    start.mutate({ amount: kopecks }, { onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") });
  };

  return (
    <>
      <Text style={styles.text}>Учёт наличных ещё не начат. Сколько наличных у вас сейчас?</Text>
      <Text style={styles.muted}>С сегодняшнего дня снятие в банкомате не тратит лимит: его тратят покупки за наличные.</Text>
      <Field label="Наличные сейчас" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Начать учёт" disabled={start.isPending} onPress={save} />
    </>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
});
