import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CashCategory, CashOperationKind, TransactionDto } from "@hale/contracts";
import { useAddCashOperation, useCash, useDeleteCashOperation, usePatchCashOperation } from "../api/queries";
import { kyivDate, parseHryvnias } from "../format";
import { SPEND_CATEGORIES, categoryLabel } from "../labels";
import { CashStartForm } from "./CashStartForm";
import { Chip } from "./Chip";
import { DateField } from "./DateField";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

const KINDS: { kind: CashOperationKind; label: string; effect: string }[] = [
  { kind: "spend", label: "Трата", effect: "Тратит лимит дня." },
  { kind: "received", label: "Получил", effect: "Наличных больше, лимит не меняется." },
  { kind: "own_out", label: "Отдал в свои", effect: "Например, купил USDC за наличные. Наличных меньше, лимит не меняется." },
];
const CATEGORIES = SPEND_CATEGORIES.filter((c): c is CashCategory => c !== "refund");
const KIND_OF_TYPE: Record<string, CashOperationKind> = { spend: "spend", person_in: "received", own_transfer: "own_out" };

type Props = { /** An operation entered earlier, to change or delete; none for a new one. */ tx?: TransactionDto; onClose: () => void };

/** A cash operation: kind, amount, category for a purchase, date and a note. */
export function CashOperationSheet({ tx, onClose }: Props) {
  const cash = useCash();
  const add = useAddCashOperation();
  const patch = usePatchCashOperation();
  const remove = useDeleteCashOperation();
  const [kind, setKind] = useState<CashOperationKind>(tx ? (KIND_OF_TYPE[tx.type ?? ""] ?? "own_out") : "spend");
  const [amount, setAmount] = useState(tx ? String(Math.abs(tx.amount) / 100) : "");
  const [category, setCategory] = useState<CashCategory | null>(tx && CATEGORIES.includes(tx.category as CashCategory) ? (tx.category as CashCategory) : null);
  const [date, setDate] = useState(tx?.localDate ?? kyivDate());
  const [note, setNote] = useState(tx?.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const busy = add.isPending || patch.isPending || remove.isPending;
  const failed = () => setMessage("Не удалось сохранить. Попробуйте ещё раз.");

  const save = () => {
    const kopecks = parseHryvnias(amount);
    if (kopecks === null || (kind === "spend" && category === null)) {
      setMessage(kind === "spend" ? "Введите сумму и выберите категорию." : "Введите сумму.");
      return;
    }
    setMessage(null);
    const base = { kind, amount: kopecks, ...(kind === "spend" ? { category: category! } : {}), date };
    if (tx) patch.mutate({ id: tx.id, patch: { ...base, note: note.trim() } }, { onSuccess: onClose, onError: failed });
    else add.mutate({ ...base, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose, onError: failed });
  };

  const confirmDelete = () =>
    Alert.alert("Удалить операцию?", "Остаток наличных и лимит пересчитаются.", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove.mutate(tx!.id, { onSuccess: onClose, onError: () => setMessage("Не удалось удалить. Попробуйте ещё раз.") }) },
    ]);

  if (!tx && cash.data && !cash.data.started) {
    return (
      <Sheet title="Наличные" onClose={onClose}>
        <CashStartForm />
      </Sheet>
    );
  }

  return (
    <Sheet title="Наличные" subtitle={tx ? "Изменить или удалить" : "Новая операция"} onClose={onClose}>
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
        ))}
      </View>
      <Text style={styles.muted}>{KINDS.find((k) => k.kind === kind)!.effect}</Text>
      <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {kind === "spend" && (
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={categoryLabel(c)} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      )}
      <DateField label="Дата" value={date} onChange={setDate} max={kyivDate()} />
      <Field label="Заметка" value={note} onChangeText={setNote} maxLength={200} />
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить" disabled={busy} onPress={save} />
      {tx && (
        <Pressable accessibilityRole="button" accessibilityLabel="Удалить" disabled={busy} onPress={confirmDelete} style={styles.delete}>
          <Text style={styles.deleteText}>Удалить</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  muted: { ...type.body, color: color.fg.muted },
  delete: { minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  deleteText: { ...type.label, color: color.status.danger },
});
