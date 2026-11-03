import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { ErrorText } from "./ErrorText";
import { useCreatePayment, useMarkPaid, useTaxPayments } from "../api/queries";
import { formatMoney, isIsoDate, parseHryvnias, shortDate, taxQuarterOfDue } from "../format";
import { Chip } from "./Chip";
import { DateField } from "./DateField";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

/** Tax payments: amount, due date and a paid mark. */
export function TaxSheet({ onClose }: { onClose: () => void }) {
  const payments = useTaxPayments();
  const markPaid = useMarkPaid();
  const [adding, setAdding] = useState(false);

  return (
    <Sheet title="Налоги" onClose={onClose}>
      {payments.isError && <ErrorText>Не получилось загрузить платежи.</ErrorText>}
      {payments.data?.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={styles.left}>
            <Text style={styles.text}>{p.name}</Text>
            <Text style={styles.note}>{`срок ${shortDate(p.due_on)}`}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.text}>{formatMoney(p.amount)}</Text>
            {p.paid_at ? (
              <Text style={styles.note}>Оплачен</Text>
            ) : (
              <Chip label="Отметить оплаченным" disabled={markPaid.isPending} onPress={() => markPaid.mutate(p.id)} />
            )}
          </View>
        </View>
      ))}
      {markPaid.isError && <ErrorText>Не удалось отметить. Попробуйте ещё раз.</ErrorText>}
      <PrimaryButton label="Новый налог" onPress={() => setAdding(true)} />
      {adding && <TaxForm onClose={() => setAdding(false)} />}
    </Sheet>
  );
}

function TaxForm({ onClose }: { onClose: () => void }) {
  const create = useCreatePayment();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const kopecks = parseHryvnias(amount);
    if (name.trim() === "" || kopecks === null || !isIsoDate(due)) {
      setMessage("Проверьте название, сумму и срок.");
      return;
    }
    setMessage(null);
    create.mutate(
      { kind: "tax", name: name.trim(), amount: kopecks, currency: "UAH", due_on: due, tax_quarter: taxQuarterOfDue(due) },
      { onSuccess: onClose, onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") },
    );
  };

  return (
    <Sheet title="Новый налог" onClose={onClose}>
      <Field label="Название платежа" value={name} onChangeText={setName} />
      <Field label="Сумма платежа" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <DateField label="Срок оплаты" value={due} onChange={setDue} />
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Добавить налог" disabled={create.isPending} onPress={add} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  left: { flex: 1 },
  right: { alignItems: "flex-end", gap: space.xs },
  text: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle },
});
