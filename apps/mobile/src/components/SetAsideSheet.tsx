import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import type { ManualBalanceDto } from "@hale/contracts";
import { useCreateSetAside, useDeleteManualBalance, usePatchManualBalance } from "../api/queries";
import { parseBalance } from "../format";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, touchMin, type } = tokens;

/** Cents as the text a person would type: 75000 -> "750", 75050 -> "750.50". */
function dollarsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Money set aside, such as a coin or a deposit: a name and what it is worth now in dollars, kept by
 * hand. It stays out of own money and the limit. Without a balance the window adds a new one.
 */
export function SetAsideSheet({ balance, onClose }: { balance?: ManualBalanceDto; onClose: () => void }) {
  const create = useCreateSetAside();
  const patch = usePatchManualBalance();
  const remove = useDeleteManualBalance();
  const [name, setName] = useState(balance?.name ?? "");
  const [amount, setAmount] = useState(balance ? dollarsText(balance.amount) : "");
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const title = name.trim();
    const cents = parseBalance(amount);
    if (!title || cents === null || cents === 0) {
      setMessage("Проверьте название и сумму.");
      return;
    }
    setMessage(null);
    const done = { onSuccess: onClose, onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз.") };
    if (balance) patch.mutate({ id: balance.id, patch: { name: title, amount: cents } }, done);
    else create.mutate({ name: title, amount: cents }, done);
  };

  const confirmRemove = (b: ManualBalanceDto) =>
    Alert.alert("Удалить счёт?", `${b.name} уйдёт из плана. На лимит это не влияет.`, [
      { text: "Оставить", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          remove.mutate(b.id, { onSuccess: onClose, onError: () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.") }),
      },
    ]);

  return (
    <Sheet title={balance?.name ?? "Отложено"} onClose={onClose}>
      <Field label="Название" value={name} onChangeText={setName} maxLength={100} />
      <Field label="Сколько стоит сейчас, $" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <Text style={styles.hint}>Цену обновляете сами, когда захотите. В лимит не входит.</Text>
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить" onPress={save} disabled={create.isPending || patch.isPending} />
      {balance ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Удалить: ${balance.name}`}
          onPress={() => confirmRemove(balance)}
          disabled={remove.isPending}
          style={styles.action}
        >
          <Text style={styles.actionText}>Удалить</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { ...type.caption, color: color.fg.muted },
  action: { minHeight: touchMin, justifyContent: "center", alignSelf: "center" },
  actionText: { ...type.label, color: color.fg.muted },
});
