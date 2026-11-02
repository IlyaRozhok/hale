import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";
import { useCreatePayment, useMarkPaid, useTaxPayments } from "../api/queries";
import { formatMoney, isIsoDate, parseHryvnias, shortDate } from "../format";
import { Chip } from "./Chip";
import { Field } from "./Field";
import { Glass } from "./Glass";

const { color, space, type } = tokens;

/** Tax payments: amount, due date, a paid mark, and a form for the next quarter's payment. */
export function TaxPayments() {
  const payments = useTaxPayments();
  const markPaid = useMarkPaid();
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
      { kind: "tax", name: name.trim(), amount: kopecks, currency: "UAH", due_on: due },
      {
        onSuccess: () => {
          setName("");
          setAmount("");
          setDue("");
        },
        onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз."),
      },
    );
  };

  return (
    <Glass style={styles.stack}>
      <Text style={styles.heading}>Налоговые платежи</Text>
      {payments.isError && <Text style={styles.muted}>Не получилось загрузить платежи.</Text>}
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
      {markPaid.isError && <Text style={styles.text}>Не удалось отметить. Попробуйте ещё раз.</Text>}
      <Text style={styles.label}>Новый платёж</Text>
      <Field label="Название платежа" value={name} onChangeText={setName} />
      <Field label="Сумма платежа" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Срок оплаты, ГГГГ-ММ-ДД" value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" autoCapitalize="none" />
      {message && <Text style={styles.text}>{message}</Text>}
      <Chip label="Добавить платёж" selected disabled={create.isPending} onPress={add} />
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  heading: { ...type.title, color: color.fg.default },
  label: { ...type.label, color: color.fg.muted },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  left: { flex: 1 },
  right: { alignItems: "flex-end", gap: space.xs },
  text: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  muted: { ...type.body, color: color.fg.muted },
  note: { ...type.caption, color: color.fg.subtle },
});
