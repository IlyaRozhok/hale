import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { useCreateInstallment, useDeleteInstallment, usePatchInstallment, usePayments } from "../api/queries";
import { isIsoDate, parseHryvnias, shortDate } from "../format";
import { type InstallmentGroup, installmentGroups, moneyIn } from "../planSummary";
import { CurrencyChoice } from "./CurrencyChoice";
import { DateField } from "./DateField";
import { EntryRow, askDelete } from "./EntryRow";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, type } = tokens;

/** Installments, each series as one line. */
export function InstallmentsSheet({ onClose }: { onClose: () => void }) {
  const payments = usePayments();
  const remove = useDeleteInstallment();
  const [editing, setEditing] = useState<InstallmentGroup | "new" | null>(null);
  const groups = payments.data ? installmentGroups(payments.data) : [];

  return (
    <Sheet title="Рассрочки" onClose={onClose}>
      {payments.isError && !payments.data && <ErrorText>Не получилось загрузить рассрочки.</ErrorText>}
      {payments.data && groups.length === 0 && <Text style={styles.muted}>Рассрочек нет.</Text>}
      {groups.map((g) => (
        <EntryRow
          key={g.name}
          title={g.name}
          detail={`${moneyIn(g.amount, g.currency)} в месяц, осталось платежей: ${g.left}, следующий ${shortDate(g.nextDue)}`}
          onEdit={() => setEditing(g)}
          onDelete={() =>
            askDelete(g.name, "Оставшиеся платежи исчезнут из плана, оплаченные останутся.", () =>
              remove.mutate(g.name, { onError: () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.") }),
            )
          }
        />
      ))}
      <PrimaryButton label="Новая рассрочка" onPress={() => setEditing("new")} />
      {editing && <InstallmentForm group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Sheet>
  );
}

function InstallmentForm({ group, onClose }: { group: InstallmentGroup | null; onClose: () => void }) {
  const create = useCreateInstallment();
  const patch = usePatchInstallment();
  const [name, setName] = useState(group?.name ?? "");
  const [amount, setAmount] = useState(group ? String(group.amount / 100) : "");
  const [currency, setCurrency] = useState(group?.currency ?? "UAH");
  const [remaining, setRemaining] = useState("");
  const [first, setFirst] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const failed = () => setMessage("Не удалось сохранить. Попробуйте ещё раз.");

  const save = () => {
    const title = name.trim();
    const minor = parseHryvnias(amount);
    const count = Number(remaining.trim());
    const countOk = remaining.trim() !== "" && Number.isInteger(count) && count >= 1 && count <= 120;
    if (title === "" || minor === null || (!group && (!countOk || !isIsoDate(first)))) {
      setMessage("Проверьте название, сумму, количество и дату.");
      return;
    }
    setMessage(null);
    if (group) patch.mutate({ name: group.name, patch: { name: title, amount: minor, currency } }, { onSuccess: onClose, onError: failed });
    else create.mutate({ name: title, amount: minor, currency, remaining: count, first_due: first }, { onSuccess: onClose, onError: failed });
  };

  return (
    <Sheet title={group ? group.name : "Новая рассрочка"} onClose={onClose}>
      <Field label="Название" value={name} onChangeText={setName} />
      <Field label="Платёж в месяц" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <CurrencyChoice value={currency} onChange={setCurrency} />
      {!group && (
        <>
          <Field label="Сколько платежей осталось" value={remaining} onChangeText={setRemaining} keyboardType="number-pad" />
          <DateField label="Первый платёж" value={first} onChange={setFirst} />
        </>
      )}
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить рассрочку" disabled={create.isPending || patch.isPending} onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({ muted: { ...type.body, color: color.fg.muted } });
