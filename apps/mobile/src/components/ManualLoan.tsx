import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@tablo/tokens";
import { useCreateLoan } from "../api/queries";
import { isIsoDate, kyivDate, parseHryvnias } from "../format";
import { Chip } from "./Chip";
import { Field } from "./Field";
import { Glass } from "./Glass";

const { color, space, type } = tokens;

/** A loan the bank did not show (a friend, a lender). Today then counts it as a bad case. */
export function ManualLoan() {
  const create = useCreateLoan();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => kyivDate());
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const kopecks = parseHryvnias(amount);
    if (kopecks === null || !isIsoDate(date)) {
      setMessage("Проверьте сумму и дату.");
      return;
    }
    setMessage(null);
    const text = note.trim();
    create.mutate(
      { amount: kopecks, received_on: date, ...(text ? { note: text } : {}) },
      {
        onSuccess: () => {
          setAmount("");
          setNote("");
          setMessage("Займ добавлен.");
        },
        onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз."),
      },
    );
  };

  return (
    <Glass style={styles.stack}>
      <Text style={styles.heading}>Займ вручную</Text>
      <Field label="Сумма займа" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Дата займа, ГГГГ-ММ-ДД" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      <Field label="Заметка к займу" value={note} onChangeText={setNote} />
      {message && <Text style={styles.text}>{message}</Text>}
      <Chip label="Добавить займ" selected disabled={create.isPending} onPress={add} />
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  heading: { ...type.title, color: color.fg.default },
  text: { ...type.body, color: color.fg.default },
});
