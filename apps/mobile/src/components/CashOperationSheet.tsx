import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CashOperationKind, TransactionDto } from "@hale/contracts";
import { exchangeRate } from "@hale/contracts/exchange";
import { useAddCashOperation, useCash, useCategoryList, useDeleteCashOperation, usePatchCashOperation, useStartCash } from "../api/queries";
import { formatDollars, formatMoney, kyivDate, parseBalance, parseHryvnias } from "../format";
import { categoryChoices } from "../labels";
import { CashStartForm } from "./CashStartForm";
import { Chip } from "./Chip";
import { DateField } from "./DateField";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

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

/** Which action of «Добавить» a new operation comes from (task Д5): each has its own title and kinds. */
export type CashMode = "spend" | "received" | "transfer";
const MODES: Record<CashMode, { title: string; kinds: CashOperationKind[] }> = {
  spend: { title: "Трата", kinds: ["spend"] },
  received: { title: "Получил", kinds: ["received"] },
  transfer: { title: "Перевёл между своими", kinds: ["own_out", "exchange"] },
};

type Props =
  | { /** An operation entered earlier, to change or delete. */ tx: TransactionDto; mode?: never; onClose: () => void }
  | { tx?: never; /** A new operation, from «Добавить». */ mode: CashMode; onClose: () => void };

/** What an exchange does, once both amounts are typed: the rate it came to, then where the money goes (task Б22). */
const exchangeEffect = (cents: number, kopecks: number) =>
  `Курс обмена ₴${exchangeRate(kopecks, cents).toFixed(2)} за $1. Binance уменьшится на ${formatDollars(cents)}, ` +
  `наличных станет больше на ${formatMoney(kopecks)}. Это перевод между своими, не доход.`;

/**
 * A cash operation: kind, amount, category for a purchase, date and a note. A new one comes from an action of
 * «Добавить» (task Д5). While the wallet is not started, a purchase asks once how much cash there is now, after
 * this purchase (the owner's decision): saving starts the wallet today (`POST /cash/start`) with that answer plus
 * the purchase, then saves the purchase, so the wallet ends at the answer. Other kinds start the wallet first, as
 * a step of its own, never combined with the operation. A purchase is spent only from cash here: the server keeps
 * no spending from a manual account.
 */
export function CashOperationSheet({ tx, mode, onClose }: Props) {
  const cash = useCash();
  const start = useStartCash();
  const add = useAddCashOperation();
  const patch = usePatchCashOperation();
  const remove = useDeleteCashOperation();
  // The server's categories, own ones included (В5); a refund is no cash purchase.
  const categories = categoryChoices(useCategoryList()).filter((c) => c.key !== "refund");
  const [kind, setKind] = useState<CashOperationKind>(tx ? (tx.exchange ? "exchange" : (KIND_OF_TYPE[tx.type ?? ""] ?? "own_out")) : MODES[mode].kinds[0]!);
  const [pocket, setPocket] = useState("");
  const [amount, setAmount] = useState(tx ? String(Math.abs(tx.amount) / 100) : "");
  const [usdc, setUsdc] = useState(tx?.exchange ? String(tx.exchange.usdc / 100) : "");
  // The row's own category, whether or not the list has come yet: it is the one to keep unless another is chosen.
  const [category, setCategory] = useState<string | null>(tx?.type === "spend" && tx.category && tx.category !== "refund" ? tx.category : null);
  const [date, setDate] = useState(tx?.localDate ?? kyivDate());
  const [note, setNote] = useState(tx?.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const busy = start.isPending || add.isPending || patch.isPending || remove.isPending;
  // Asked once, in a purchase only, while the server says the wallet is not started.
  const notStarted = !tx && cash.data?.started === false;
  const firstTime = notStarted && mode === "spend";
  const kinds = tx ? KINDS : KINDS.filter((k) => MODES[mode].kinds.includes(k.kind));
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
    const inPocket = parseBalance(pocket);
    if (firstTime && inPocket === null) {
      setMessage("Введите, сколько наличных сейчас, можно 0.");
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
    if (tx) {
      patch.mutate({ id: tx.id, patch: { ...base, note: note.trim() } }, { onSuccess: onClose, onError: failed });
      return;
    }
    const addIt = () => add.mutate({ ...base, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose, onError: failed });
    // The answer is the cash after this purchase, so the wallet starts with it plus the purchase. If the purchase
    // then fails, the wallet stays started and a second try only saves it. A failed start (a 409: started
    // elsewhere) reads the wallet again, so the next try does not start it twice.
    const startFailed = () => {
      failed();
      void cash.refetch();
    };
    if (firstTime) start.mutate({ amount: inPocket! + kopecks }, { onSuccess: addIt, onError: startFailed });
    else addIt();
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

  if (notStarted && !firstTime) {
    return (
      <Sheet title={MODES[mode!].title} onClose={onClose}>
        <CashStartForm />
      </Sheet>
    );
  }

  return (
    <Sheet title={tx ? "Наличные" : MODES[mode].title} subtitle={tx ? "Изменить или удалить" : undefined} onClose={onClose}>
      {/* Two kinds («Перевёл между своими») fit the native switch; all four, when an operation is edited, do not:
          «Отдал в свои» and «Обменял USDC» would be cut short in a quarter of the row, so they stay chips. */}
      {!correction && kinds.length === 2 && (
        <Segmented testID="cash-kind" options={kinds.map((k) => ({ key: k.kind, label: k.label }))} value={kind} onChange={setKind} />
      )}
      {!correction && kinds.length > 2 && (
        <View style={styles.chips}>
          {kinds.map((k) => (
            <Chip key={k.kind} label={k.label} selected={kind === k.kind} onPress={() => setKind(k.kind)} />
          ))}
        </View>
      )}
      {mode === "spend" && (
        <View style={styles.group}>
          <Text style={styles.caption}>С чего</Text>
          <View style={styles.chips}>
            <Chip role="radio" label="Наличные" selected onPress={() => undefined} />
          </View>
        </View>
      )}
      {firstTime && (
        <View style={styles.start}>
          <Text style={styles.startTitle}>Сколько наличных сейчас?</Text>
          <Field label="Наличные после этой траты" placeholder="₴0" value={pocket} onChangeText={setPocket} keyboardType="decimal-pad" />
          <Text style={styles.caption}>Уже без этой траты. Спросим один раз.</Text>
          <Text style={styles.caption}>С сегодняшнего дня снятие в банкомате не тратит лимит: его тратят покупки за наличные.</Text>
        </View>
      )}
      {kind === "exchange" ? (
        <>
          <Field label="Отдал USDC, $" value={usdc} onChangeText={setUsdc} keyboardType="decimal-pad" />
          <Field label="Получил наличными, ₴" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Text style={styles.muted}>{cents !== null && kopecks !== null ? exchangeEffect(cents, kopecks) : effect}</Text>
        </>
      ) : (
        <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      )}
      {kind === "spend" && (
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip key={c.key} label={c.name} selected={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </View>
      )}
      {kind !== "exchange" && <Text style={styles.muted}>{effect}</Text>}
      {/* The wallet starts today: a first operation can be no earlier. */}
      {!firstTime && <DateField label="Дата" value={date} onChange={setDate} max={kyivDate()} />}
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
  group: { gap: space.xs },
  caption: { ...type.caption, color: color.fg.muted },
  start: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.surface.raised },
  startTitle: { ...type.label, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  delete: { minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  deleteText: { ...type.label, color: color.status.danger },
});
