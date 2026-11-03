import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { useRepayLoan } from "../api/queries";
import { formatMoney, isIsoDate, kyivDate, parseHryvnias } from "../format";
import { Field } from "./Field";
import { Sheet } from "./Sheet";

const { color, radius, touchMin, type } = tokens;

type Props = { loanId: number; remaining: number; name: string; onClose: () => void };

/** "Погасил": how much and when. What is owed is filled in, so the usual case is one tap. */
export function RepayLoanSheet({ loanId, remaining, name, onClose }: Props) {
  const repay = useRepayLoan();
  const [amount, setAmount] = useState(String(remaining / 100));
  const [date, setDate] = useState(() => kyivDate());
  const [message, setMessage] = useState<string | null>(null);

  const kopecks = parseHryvnias(amount);
  const effect =
    kopecks === null || kopecks === remaining
      ? null
      : kopecks < remaining
        ? `Останется ${formatMoney(remaining - kopecks)}, займ будет открыт.`
        : `${formatMoney(kopecks - remaining)} сверх займа уйдут в обслуживание.`;

  const save = () => {
    if (kopecks === null || !isIsoDate(date)) {
      setMessage("Проверьте сумму и дату.");
      return;
    }
    setMessage(null);
    repay.mutate(
      { id: loanId, input: { amount: kopecks, date } },
      { onSuccess: onClose, onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") },
    );
  };

  return (
    <Sheet title="Погасил" subtitle={name} onClose={onClose}>
      <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Дата, ГГГГ-ММ-ДД" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      {effect && <Text style={styles.text}>{effect}</Text>}
      {message && <Text style={styles.text}>{message}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: repay.isPending }}
        disabled={repay.isPending}
        onPress={save}
        style={[styles.save, repay.isPending && styles.pending]}
      >
        <Text style={styles.saveText}>Сохранить</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: color.fg.default },
  save: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  saveText: { ...type.label, color: color.accent.fgOnAccent },
  pending: { opacity: 0.6 },
});
