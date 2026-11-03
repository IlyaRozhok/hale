import { useState } from "react";
import { useCreateLoan } from "../api/queries";
import { isIsoDate, kyivDate, parseHryvnias } from "../format";
import { DateField } from "./DateField";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";


/** A loan the bank did not show (a friend, a lender). Today then counts it as a bad case. */
export function ManualLoanSheet({ onClose }: { onClose: () => void }) {
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
      { onSuccess: onClose, onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") },
    );
  };

  return (
    <Sheet title="Новый займ" onClose={onClose}>
      <Field label="Сумма займа" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <DateField label="Дата займа" value={date} onChange={setDate} max={kyivDate()} />
      <Field label="Заметка к займу" value={note} onChangeText={setNote} />
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Добавить займ" disabled={create.isPending} onPress={add} />
    </Sheet>
  );
}
