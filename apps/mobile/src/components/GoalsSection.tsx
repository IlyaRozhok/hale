import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { GoalDto } from "@hale/contracts";
import { useCreateGoal, useDeleteGoal, useGoals, usePatchGoal } from "../api/queries";
import { formatDollars, goalPercent, parseBalance } from "../format";
import { Chip } from "./Chip";
import { Field } from "./Field";
import { Glass } from "./Glass";
import { ProgressBar } from "./ProgressBar";

const { color, space, touchMin, type } = tokens;

const SAVE_FAILED = "Не удалось сохранить. Попробуйте ещё раз.";

function GoalItem({ goal }: { goal: GoalDto }) {
  const patch = usePatchGoal();
  const remove = useDeleteGoal();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const cents = parseBalance(amount);
    if (cents === null) {
      setMessage("Проверьте сумму.");
      return;
    }
    setMessage(null);
    patch.mutate(
      { id: goal.id, patch: { saved_cents: cents } },
      {
        onSuccess: () => {
          setEditing(false);
          setAmount("");
        },
        onError: () => setMessage(SAVE_FAILED),
      },
    );
  };

  const confirmRemove = () =>
    Alert.alert("Удалить цель?", goal.name, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => remove.mutate(goal.id, { onError: () => setMessage(SAVE_FAILED) }),
      },
    ]);

  return (
    <View style={styles.item}>
      <Text style={styles.name}>{goal.name}</Text>
      <Text style={styles.muted}>{`${formatDollars(goal.saved_cents)} из ${formatDollars(goal.target_cents)}`}</Text>
      <ProgressBar percent={goalPercent(goal.saved_cents, goal.target_cents)} />
      {editing ? (
        <>
          <Field label="Накоплено, $" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <View style={styles.actions}>
            <Chip label="Сохранить" onPress={save} disabled={patch.isPending} />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <TextButton label="Изменить накопленное" a11y={`Изменить накопленное: ${goal.name}`} onPress={() => setEditing(true)} />
          <TextButton label="Удалить" a11y={`Удалить цель: ${goal.name}`} onPress={confirmRemove} />
        </View>
      )}
      {message ? <Text style={styles.muted}>{message}</Text> : null}
    </View>
  );
}

function TextButton({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.textButton}>
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

/** Savings goals kept by hand: a name, a target in dollars and how much is saved. */
export function GoalsSection() {
  const goals = useGoals();
  const create = useCreateGoal();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const cents = parseBalance(target);
    const title = name.trim();
    if (!title || cents === null || cents === 0) {
      setMessage("Проверьте название и сумму.");
      return;
    }
    setMessage(null);
    create.mutate(
      { name: title, target_cents: cents },
      {
        onSuccess: () => {
          setName("");
          setTarget("");
          setMessage("Цель добавлена.");
        },
        onError: () => setMessage(SAVE_FAILED),
      },
    );
  };

  return (
    <Glass style={styles.stack}>
      <Text style={styles.heading}>Цели</Text>
      {goals.isError && !goals.data ? <Text style={styles.muted}>Не получилось загрузить цели.</Text> : null}
      {goals.data?.map((g) => <GoalItem key={g.id} goal={g} />)}
      <Field label="Название цели" value={name} onChangeText={setName} />
      <Field label="Сумма цели, $" keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      <Chip label="Добавить цель" onPress={add} disabled={create.isPending} />
      {message ? <Text style={styles.muted}>{message}</Text> : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  item: { gap: space.xs, paddingBottom: space.sm },
  heading: { ...type.title, color: color.fg.default },
  name: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  actions: { flexDirection: "row", gap: space.lg, alignItems: "center" },
  textButton: { minHeight: touchMin, justifyContent: "center" },
  textButtonLabel: { ...type.label, color: color.fg.muted },
});
