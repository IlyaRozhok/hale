import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { GoalDto } from "@hale/contracts";
import { ErrorText } from "./ErrorText";
import { useCreateGoal, useDeleteGoal, useGoals, usePatchGoal } from "../api/queries";
import { formatDollars, goalPercent, parseBalance } from "../format";
import { DeleteAction, EntryRow } from "./EntryRow";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { ProgressBar } from "./ProgressBar";
import { Sheet } from "./Sheet";

const { space } = tokens;

const SAVE_FAILED = "Не удалось сохранить. Попробуйте ещё раз.";

/** A goal as a row: saved of target and progress; a touch opens its form (ЯМ5). */
function GoalItem({ goal }: { goal: GoalDto }) {
  const [editing, setEditing] = useState(false);
  return (
    <View style={styles.item}>
      <EntryRow title={goal.name} detail={`${formatDollars(goal.saved_cents)} из ${formatDollars(goal.target_cents)}`} onPress={() => setEditing(true)}>
        <ProgressBar percent={goalPercent(goal.saved_cents, goal.target_cents)} />
      </EntryRow>
      {editing && <GoalEditForm goal={goal} onClose={() => setEditing(false)} />}
    </View>
  );
}

/** A goal's form: the saved amount, as before, and a quiet «Удалить цель» under it. */
function GoalEditForm({ goal, onClose }: { goal: GoalDto; onClose: () => void }) {
  const patch = usePatchGoal();
  const remove = useDeleteGoal();
  const [amount, setAmount] = useState(String(goal.saved_cents / 100));
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const cents = parseBalance(amount);
    if (cents === null) {
      setMessage("Проверьте сумму.");
      return;
    }
    setMessage(null);
    patch.mutate({ id: goal.id, patch: { saved_cents: cents } }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  const confirmRemove = () =>
    Alert.alert("Удалить цель?", goal.name, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => remove.mutate(goal.id, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) }),
      },
    ]);

  return (
    <Sheet title={goal.name} onClose={onClose}>
      <Field label="Накоплено, $" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить цель" onPress={save} disabled={patch.isPending} />
      <DeleteAction label="Удалить цель" disabled={patch.isPending || remove.isPending} onPress={confirmRemove} />
    </Sheet>
  );
}

/** Savings goals kept by hand: a name, a target in dollars and how much is saved. */
export function GoalsSheet({ onClose }: { onClose: () => void }) {
  const goals = useGoals();
  const [adding, setAdding] = useState(false);

  return (
    <Sheet title="Цели" onClose={onClose}>
      {goals.isError && !goals.data ? <ErrorText>Не получилось загрузить цели.</ErrorText> : null}
      {goals.data?.map((g) => <GoalItem key={g.id} goal={g} />)}
      <PrimaryButton label="Новая цель" onPress={() => setAdding(true)} />
      {adding && <GoalForm onClose={() => setAdding(false)} />}
    </Sheet>
  );
}

/** One goal in its own window, opened from Today: progress, change the saved amount, delete. */
export function GoalSheet({ goalId, onClose }: { goalId: number; onClose: () => void }) {
  const goals = useGoals();
  const goal = goals.data?.find((g) => g.id === goalId);
  return (
    <Sheet title={goal?.name ?? "Цель"} onClose={onClose}>
      {goals.isError && !goals.data ? <ErrorText>Не получилось загрузить цель.</ErrorText> : null}
      {goal ? <GoalItem goal={goal} /> : null}
    </Sheet>
  );
}

function GoalForm({ onClose }: { onClose: () => void }) {
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
    create.mutate({ name: title, target_cents: cents }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  return (
    <Sheet title="Новая цель" onClose={onClose}>
      <Field label="Название цели" value={name} onChangeText={setName} />
      <Field label="Сумма цели, $" keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Добавить цель" onPress={add} disabled={create.isPending} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: { paddingBottom: space.sm },
});
