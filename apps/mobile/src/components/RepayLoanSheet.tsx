import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { ApiError } from "../api/client";
import { useRepayLoan } from "../api/queries";
import { formatMoney, isIsoDate, kyivDate, parseHryvnias } from "../format";
import { DateField } from "./DateField";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, type } = tokens;

type Props = { loanId: number; remaining: number; /** The earliest date it could be repaid. */ receivedOn?: string; name: string; onClose: () => void };

/** "Погасил": how much and when. What is owed is filled in, so the usual case is one tap. */
export function RepayLoanSheet({ loanId, remaining, receivedOn, name, onClose }: Props) {
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
      {
        onSuccess: onClose,
        onError: (e) =>
          setMessage(e instanceof ApiError && e.status === 422 ? "Дата должна быть не раньше дня займа и не позже сегодня." : "Не удалось сохранить. Попробуйте ещё раз."),
      },
    );
  };

  return (
    <Sheet title="Погасил" subtitle={name} onClose={onClose}>
      <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <DateField label="Дата" value={date} onChange={setDate} min={receivedOn} max={kyivDate()} />
      {effect && <Text style={styles.text}>{effect}</Text>}
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить" disabled={repay.isPending} onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: color.fg.default },
});
