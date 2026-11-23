import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { RecurringDto, ScheduledPaymentDto } from "@hale/contracts";
import { useCreatePayment, useCreateRecurring, useDeletePayment, useDeleteRecurring, usePatchPayment, usePatchRecurring, usePayments, useRecurring } from "../api/queries";
import { isIsoDate, parseHryvnias, shortDate } from "../format";
import { moneyIn } from "../planSummary";
import { CurrencyChoice } from "./CurrencyChoice";
import { DateField } from "./DateField";
import { DeleteAction, EntryRow, askDelete } from "./EntryRow";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

const deleteFailed = () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.");

type Editing = { monthly: RecurringDto } | { once: ScheduledPaymentDto } | "new";

/** Obligatory payments: the monthly ones, and the one-off ones still to pay. */
export function PaymentsSheet({ onClose }: { onClose: () => void }) {
  const recurring = useRecurring();
  const payments = usePayments();
  const [editing, setEditing] = useState<Editing | null>(null);

  const monthly = recurring.data?.filter((r) => r.active && r.kind === "obligation") ?? [];
  const once = payments.data?.filter((p) => p.kind === "obligation" && p.recurring_id === null && p.paid_at === null) ?? [];

  return (
    <Sheet title="Платежи" onClose={onClose}>
      {(recurring.isError || payments.isError) && <ErrorText>Не получилось загрузить платежи.</ErrorText>}
      {recurring.data && payments.data && monthly.length + once.length === 0 && <Text style={styles.muted}>Обязательных платежей нет.</Text>}
      {monthly.map((r) => (
        <EntryRow
          key={`m${r.id}`}
          title={r.name}
          detail={`${moneyIn(r.amount, r.currency)}, каждый месяц, ${r.day_of_month} числа`}
          onPress={() => setEditing({ monthly: r })}
        />
      ))}
      {once.map((p) => (
        <EntryRow
          key={`o${p.id}`}
          title={p.name}
          detail={`${moneyIn(p.amount, p.currency)}, срок ${shortDate(p.due_on)}`}
          onPress={() => setEditing({ once: p })}
        />
      ))}
      <PrimaryButton label="Новый платёж" onPress={() => setEditing("new")} />
      {editing && <PaymentForm editing={editing} onClose={() => setEditing(null)} />}
    </Sheet>
  );
}

function PaymentForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const row = editing === "new" ? null : "monthly" in editing ? editing.monthly : editing.once;
  const dayOfMonth = editing !== "new" && "monthly" in editing ? editing.monthly.day_of_month : null;
  const dueOn = editing !== "new" && "once" in editing ? editing.once.due_on : "";
  const createMonthly = useCreateRecurring();
  const patchMonthly = usePatchRecurring();
  const createOnce = useCreatePayment();
  const patchOnce = usePatchPayment();
  const removeMonthly = useDeleteRecurring();
  const removeOnce = useDeletePayment();
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(row ? String(row.amount / 100) : "");
  const [currency, setCurrency] = useState(row?.currency ?? "UAH");
  const [isMonthly, setIsMonthly] = useState(editing === "new" || dayOfMonth !== null);
  const [day, setDay] = useState(dayOfMonth === null ? "" : String(dayOfMonth));
  const [due, setDue] = useState(dueOn);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const title = name.trim();
    const minor = parseHryvnias(amount);
    const n = Number(day.trim());
    const dayOk = day.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 31;
    if (title === "" || minor === null || (isMonthly ? !dayOk : !isIsoDate(due))) {
      setMessage("Проверьте название, сумму и дату.");
      return;
    }
    setMessage(null);
    setBusy(true);
    const values = { name: title, amount: minor, currency };
    try {
      if (editing === "new") {
        if (isMonthly) await createMonthly.mutateAsync({ ...values, day_of_month: n });
        else await createOnce.mutateAsync({ kind: "obligation", ...values, due_on: due });
      } else if ("monthly" in editing) {
        await patchMonthly.mutateAsync({ id: editing.monthly.id, patch: { ...values, day_of_month: n } });
      } else {
        await patchOnce.mutateAsync({ id: editing.once.id, patch: { ...values, due_on: due } });
      }
      onClose();
    } catch {
      setMessage("Не удалось сохранить. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  // Deleting asks the same question it asked under the row, and closes the form once done.
  const remove = () => {
    if (editing === "new") return;
    if ("monthly" in editing) {
      const r = editing.monthly;
      askDelete(r.name, "Неоплаченные платежи исчезнут из плана, оплаченные останутся.", () => removeMonthly.mutate(r.id, { onSuccess: onClose, onError: deleteFailed }));
    } else {
      const p = editing.once;
      askDelete(p.name, "Платёж исчезнет из плана.", () => removeOnce.mutate(p.id, { onSuccess: onClose, onError: deleteFailed }));
    }
  };

  return (
    <Sheet title={row ? row.name : "Новый платёж"} onClose={onClose}>
      <Field label="Название" value={name} onChangeText={setName} />
      <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <CurrencyChoice value={currency} onChange={setCurrency} />
      {editing === "new" && (
        <View style={styles.switchRow}>
          <Text style={styles.text}>Каждый месяц</Text>
          <Switch
            accessibilityRole="switch"
            accessibilityLabel="Каждый месяц"
            value={isMonthly}
            onValueChange={setIsMonthly}
            trackColor={{ false: color.data.track, true: color.accent.default }}
            thumbColor={color.fg.default}
          />
        </View>
      )}
      {isMonthly ? (
        <Field label="Какого числа" value={day} onChangeText={setDay} keyboardType="number-pad" />
      ) : (
        <DateField label="Срок" value={due} onChange={setDue} />
      )}
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить платёж" disabled={busy} onPress={() => void save()} />
      {row && <DeleteAction label="Удалить платёж" disabled={busy || removeMonthly.isPending || removeOnce.isPending} onPress={remove} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.body, color: color.fg.muted },
  text: { ...type.body, color: color.fg.default },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
});
