import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CashOperationKind, TransactionDto } from "@hale/contracts";
import { exchangeRate } from "@hale/contracts/exchange";
import { useAddCashOperation, useCash, useCategoryList, useDeleteCashOperation, usePatchCashOperation } from "../api/queries";
import { formatDollars, formatMoney, kyivDate, parseHryvnias } from "../format";
import { categoryChoices } from "../labels";
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
  { kind: "exchange", label: "Обменял USDC", effect: "Binance уменьшится на отданные USDC, наличных станет больше. Это перевод между своими, не доход." },
];
const KIND_OF_TYPE: Record<string, CashOperationKind> = { spend: "spend", person_in: "received", own_transfer: "own_out" };
/**
 * The opening balance or a count that found more: an own transfer into the wallet that is no exchange. It corrects
 * the balance and is no operation of any kind; read as «Отдал в свои» it would be saved as a minus.
 */
const isCorrection = (tx: TransactionDto) => tx.type === "own_transfer" && tx.amount > 0 && !tx.exchange;

type Props = { /** An operation entered earlier, to change or delete; none for a new one. */ tx?: TransactionDto; onClose: () => void };

/** What an exchange does, once both amounts are typed: the rate it came to, then where the money goes (task Б22). */
const exchangeEffect = (cents: number, kopecks: number) =>
  `Курс обмена ₴${exchangeRate(kopecks, cents).toFixed(2)} за $1. Binance уменьшится на ${formatDollars(cents)}, ` +
  `наличных станет больше на ${formatMoney(kopecks)}. Это перевод между своими, не доход.`;

/** A cash operation: kind, amount, category for a purchase, date and a note. */
export function CashOperationSheet({ tx, onClose }: Props) {
  const cash = useCash();
  const add = useAddCashOperation();
  const patch = usePatchCashOperation();
  const remove = useDeleteCashOperation();
  // The server's categories, own ones included (В5); a refund is no cash purchase.
  const categories = categoryChoices(useCategoryList()).filter((c) => c.key !== "refund");
  const [kind, setKind] = useState<CashOperationKind>(tx ? (tx.exchange ? "exchange" : (KIND_OF_TYPE[tx.type ?? ""] ?? "own_out")) : "spend");
  const [amount, setAmount] = useState(tx ? String(Math.abs(tx.amount) / 100) : "");
  const [usdc, setUsdc] = useState(tx?.exchange ? String(tx.exchange.usdc / 100) : "");
  // The row's own category, whether or not the list has come yet: it is the one to keep unless another is chosen.
  const [category, setCategory] = useState<string | null>(tx?.type === "spend" && tx.category && tx.category !== "refund" ? tx.category : null);
  const [date, setDate] = useState(tx?.localDate ?? kyivDate());
  const [note, setNote] = useState(tx?.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const busy = add.isPending || patch.isPending || remove.isPending;
  const failed = () => setMessage("Не удалось сохранить. Попробуйте ещё раз.");

  const kopecks = parseHryvnias(amount);
  const cents = parseHryvnias(usdc);
  const correction = tx !== undefined && isCorrection(tx);
  const effect = correction ? "Поправка остатка наличных." : KINDS.find((k) => k.kind === kind)!.effect;

  const save = () => {
    if (kind === "exchange" && (kopecks === null || cents === null)) {
      setMessage("Введите, сколько USDC отдали и сколько гривен получили.");
      return;
    }
    if (kopecks === null || (kind === "spend" && category === null)) {
      setMessage(kind === "spend" ? "Введите сумму и выберите категорию." : "Введите сумму.");
      return;
    }
    setMessage(null);
    if (correction) {
      // No kind: the server keeps a correction a plus.
      patch.mutate({ id: tx!.id, patch: { amount: kopecks, date, note: note.trim() } }, { onSuccess: onClose, onError: failed });
      return;
    }
    const base = {
      kind,
      ...(kind === "exchange" ? { usdc: cents! } : {}),
      amount: kopecks,
      ...(kind === "spend" ? { category: category! } : {}),
      date,
    };
    if (tx) patch.mutate({ id: tx.id, patch: { ...base, note: note.trim() } }, { onSuccess: onClose, onError: failed });
    else add.mutate({ ...base, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose, onError: failed });
  };

  const confirmDelete = () =>
    Alert.alert("Удалить операцию?", "Остаток наличных и лимит пересчитаются.", [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove.mutate(tx!.id, { onSuccess: onClose, onError: () => setMessage("Не удалось удалить. Попробуйте ещё раз.") }) },
    ]);

  if (tx?.type === "obligation") {
    return (
      <Sheet title={tx.description} subtitle="Наличные" onClose={onClose}>
        <Text style={styles.muted}>Платёж из плана, оплачен наличными. Если удалить, платёж снова станет неоплаченным.</Text>
        {message && <ErrorText>{message}</ErrorText>}
        <Pressable accessibilityRole="button" accessibilityLabel="Удалить" disabled={busy} onPress={confirmDelete} style={styles.delete}>
          <Text style={styles.deleteText}>Удалить</Text>
        </Pressable>
      </Sheet>
    );
  }

  if (!tx && cash.data && !cash.data.started) {
    return (
      <Sheet title="Наличные" onClose={onClose}>
        <CashStartForm />
      </Sheet>
    );
  }

  return (
    <Sheet title="Наличные" subtitle={tx ? "Изменить или удалить" : "Новая операция"} onClose={onClose}>
      {!correction && (
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
          ))}
        </View>
      )}
      {kind === "exchange" ? (
        <>
          <Field label="Отдал USDC, $" value={usdc} onChangeText={setUsdc} keyboardType="decimal-pad" />
          <Field label="Получил наличными, ₴" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Text style={styles.muted}>{cents !== null && kopecks !== null ? exchangeEffect(cents, kopecks) : effect}</Text>
        </>
      ) : (
        <>
          <Text style={styles.muted}>{effect}</Text>
          <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </>
      )}
      {kind === "spend" && (
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip key={c.key} label={c.name} selected={category === c.key} onPress={() => setCategory(c.key)} />
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
