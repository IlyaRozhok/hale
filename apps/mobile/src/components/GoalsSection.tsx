import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { GoalDto, GoalPatch, GoalPlace } from "@hale/contracts";
import { ErrorText } from "./ErrorText";
import { useCreateGoal, useDeleteGoal, useGoals, usePatchGoal, useToday } from "../api/queries";
import { goalPercent, parseBalance } from "../format";
import { goalDetail, goalPlaces, type GoalPlaceOption } from "../ownMoney";
import { NewAccountSheet } from "./AccountSheet";
import { DeleteAction, EntryRow } from "./EntryRow";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { PrimaryButton } from "./PrimaryButton";
import { ProgressBar } from "./ProgressBar";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

const SAVE_FAILED = "Не удалось сохранить. Попробуйте ещё раз.";
const SAVE_FAILED_IN_PLACE = "Не удалось сохранить. Можно выбрать «Без места» и попробовать ещё раз.";
const IN_PLACE_NOTE = "Накоплено — сколько лежит на этом месте. Вводить вручную не нужно.";

/** The sign a currency goes by in a field's label: «₴», «$», «€», or its code. */
const MARKS: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€" };
const mark = (currency: string) => MARKS[currency] ?? currency;

const samePlace = (a: GoalPlace | null, b: GoalPlace | null | undefined) => (a === null ? !b : !!b && a.source === b.source && a.id === b.id);
const asPlace = (p: GoalPlace): GoalPlace => ({ source: p.source, id: p.id });

/** The places a goal can be kept in (ЯМ5), as «Сегодня» lists them. */
function useGoalPlaces(): GoalPlaceOption[] {
  return goalPlaces(useToday().data?.accounts);
}

/**
 * «Где копите?» (ЯМ5): the places with their balances, one marked, «Без места» for a goal kept by hand, and, for a new
 * goal, «Другое место» opening the same «Новый счёт» as «Отложено».
 */
function PlacePicker({
  options,
  value,
  onChange,
  onOther,
}: {
  options: GoalPlaceOption[];
  value: GoalPlace | null;
  onChange: (place: GoalPlaceOption | null) => void;
  onOther?: () => void;
}) {
  const row = (key: string, label: string, balance: string | null, icon: GoalPlaceOption["icon"] | null, on: boolean, onPress: () => void) => (
    <Pressable key={key} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} style={styles.place}>
      {icon ? <Icon name={icon} color={color.list.icon} size={18} /> : null}
      <Text style={styles.placeName} numberOfLines={1}>
        {label}
      </Text>
      {balance ? <Text style={styles.placeBalance}>{balance}</Text> : null}
      <Icon name={on ? "check" : "circle"} color={on ? color.accent.signal : color.fg.subtle} size={18} />
    </Pressable>
  );
  return (
    <View style={styles.picker}>
      <Text style={styles.heading}>Где копите?</Text>
      {options.map((p) => row(`${p.source}:${p.id}`, p.name, p.balance, p.icon, samePlace(p, value), () => onChange(p)))}
      {row("none", "Без места", null, null, value === null, () => onChange(null))}
      {onOther ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Другое место" onPress={onOther} style={styles.place}>
          <Icon name="plus" color={color.list.icon} size={18} />
          <Text style={styles.placeName}>Другое место</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A goal as a row: saved of target in its currency, where it is kept, and progress; a touch opens its form (ЯМ5). */
function GoalItem({ goal }: { goal: GoalDto }) {
  const [editing, setEditing] = useState(false);
  return (
    <View style={styles.item}>
      <EntryRow title={goal.name} detail={goalDetail(goal)} onPress={() => setEditing(true)}>
        <ProgressBar percent={goalPercent(goal.saved_cents, goal.target_cents)} />
      </EntryRow>
      {editing && (goal.currency === undefined ? <OlderGoalForm goal={goal} onClose={() => setEditing(false)} /> : <GoalEditForm goal={goal} onClose={() => setEditing(false)} />)}
    </View>
  );
}

/** Deleting a goal asks first; the money on its place stays where it is. */
function useRemoveGoal(goal: GoalDto, onClose: () => void, onError: () => void) {
  const remove = useDeleteGoal();
  const confirm = () =>
    Alert.alert("Удалить цель?", goal.name, [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove.mutate(goal.id, { onSuccess: onClose, onError }) },
    ]);
  return { confirm, pending: remove.isPending };
}

/** An older server's goal (no currency): the saved amount in dollars by hand, as before ЯМ5. */
function OlderGoalForm({ goal, onClose }: { goal: GoalDto; onClose: () => void }) {
  const patch = usePatchGoal();
  const [amount, setAmount] = useState(String(goal.saved_cents / 100));
  const [message, setMessage] = useState<string | null>(null);
  const remove = useRemoveGoal(goal, onClose, () => setMessage(SAVE_FAILED));

  const save = () => {
    const cents = parseBalance(amount);
    if (cents === null) {
      setMessage("Проверьте сумму.");
      return;
    }
    setMessage(null);
    patch.mutate({ id: goal.id, patch: { saved_cents: cents } }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  return (
    <Sheet title={goal.name} onClose={onClose}>
      <Field label="Накоплено, $" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить цель" onPress={save} disabled={patch.isPending} />
      <DeleteAction label="Удалить цель" disabled={patch.isPending || remove.pending} onPress={remove.confirm} />
    </Sheet>
  );
}

/**
 * A goal's form on a newer server (ЯМ5): the name, where it is kept, the target in that place's currency, and «Накоплено»
 * by hand only for a goal without a place. Moving it to a place in another currency asks for the target anew.
 */
function GoalEditForm({ goal, onClose }: { goal: GoalDto; onClose: () => void }) {
  const patch = usePatchGoal();
  const listed = useGoalPlaces();
  const goalCurrency = goal.currency ?? "USD";
  // The goal's own place stays a choice even when «Сегодня» does not list it now.
  const options =
    goal.place && !listed.some((p) => samePlace(p, goal.place))
      ? [...listed, { ...asPlace(goal.place), name: goal.place.name, currency: goalCurrency, balance: null, icon: goal.place.source === "manual" ? ("lock" as const) : ("card" as const) }]
      : listed;
  const originalTarget = String(goal.target_cents / 100);
  const [name, setName] = useState(goal.name);
  const [place, setPlace] = useState<GoalPlace | null>(goal.place ? asPlace(goal.place) : null);
  const [currency, setCurrency] = useState(goalCurrency);
  const [target, setTarget] = useState(originalTarget);
  // With a place the server knows nothing typed by hand, so the field starts empty when the place is taken off.
  const [saved, setSaved] = useState(goal.place ? "" : String(goal.saved_cents / 100));
  const [message, setMessage] = useState<string | null>(null);
  const remove = useRemoveGoal(goal, onClose, () => setMessage(SAVE_FAILED));

  const choose = (p: GoalPlaceOption | null) => {
    const next = p ? p.currency : goalCurrency;
    if (next !== currency) setTarget(next === goalCurrency ? originalTarget : "");
    setCurrency(next);
    setPlace(p ? asPlace(p) : null);
  };

  const save = () => {
    const title = name.trim();
    const cents = parseBalance(target);
    if (!title) {
      setMessage("Проверьте название и сумму.");
      return;
    }
    if (cents === null || cents === 0) {
      setMessage("Проверьте сумму.");
      return;
    }
    const changes: GoalPatch = {};
    if (title !== goal.name) changes.name = title;
    if (!samePlace(place, goal.place)) changes.place = place;
    if (cents !== goal.target_cents || currency !== goalCurrency) changes.target_cents = cents;
    if (place === null && saved.trim() !== "") {
      const hand = parseBalance(saved);
      if (hand === null) {
        setMessage("Проверьте сумму.");
        return;
      }
      if (goal.place || hand !== goal.saved_cents) changes.saved_cents = hand;
    }
    setMessage(null);
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    patch.mutate({ id: goal.id, patch: changes }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  return (
    <Sheet title={goal.name} onClose={onClose}>
      <Field label="Название цели" value={name} onChangeText={setName} maxLength={100} />
      <PlacePicker options={options} value={place} onChange={choose} />
      <Field label={`Сумма цели, ${mark(currency)}`} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      {place ? (
        <Text style={styles.note}>{IN_PLACE_NOTE}</Text>
      ) : (
        <Field label={`Накоплено, ${mark(currency)}`} keyboardType="decimal-pad" value={saved} onChangeText={setSaved} />
      )}
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить цель" onPress={save} disabled={patch.isPending} />
      <DeleteAction label="Удалить цель" disabled={patch.isPending || remove.pending} onPress={remove.confirm} />
    </Sheet>
  );
}

/** Savings goals: a name, a target, and how much is saved, read from the goal's place when it has one (ЯМ5). */
export function GoalsSheet({ onClose }: { onClose: () => void }) {
  const goals = useGoals();
  const [adding, setAdding] = useState(false);
  // A newer server's goals carry a currency. With none yet there is nothing to tell by, and the places are offered.
  const newer = goals.data !== undefined && (goals.data.length === 0 || goals.data.some((g) => g.currency !== undefined));

  return (
    <Sheet title="Цели" onClose={onClose}>
      {goals.isError && !goals.data ? <ErrorText>Не получилось загрузить цели.</ErrorText> : null}
      {goals.data?.map((g) => <GoalItem key={g.id} goal={g} />)}
      <PrimaryButton label="Новая цель" onPress={() => setAdding(true)} />
      {adding && <GoalForm withPlaces={newer} onClose={() => setAdding(false)} />}
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

/** A new goal: its name, «Где копите?» on a newer server, and the target in the chosen place's currency. */
function GoalForm({ withPlaces, onClose }: { withPlaces: boolean; onClose: () => void }) {
  const create = useCreateGoal();
  const listed = useGoalPlaces();
  const places = withPlaces && listed.length > 0;
  const [name, setName] = useState("");
  const [place, setPlace] = useState<GoalPlaceOption | null>(null);
  const [target, setTarget] = useState("");
  const [addingPlace, setAddingPlace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const cents = parseBalance(target);
    const title = name.trim();
    if (!title || cents === null || cents === 0) {
      setMessage("Проверьте название и сумму.");
      return;
    }
    setMessage(null);
    const input = place ? { name: title, target_cents: cents, place: asPlace(place) } : { name: title, target_cents: cents };
    // An older server with no goals yet takes no place: «Без места» is the way on.
    create.mutate(input, { onSuccess: onClose, onError: () => setMessage(place ? SAVE_FAILED_IN_PLACE : SAVE_FAILED) });
  };

  const choose = (p: GoalPlaceOption | null) => {
    if ((p?.currency ?? "USD") !== (place?.currency ?? "USD")) setTarget("");
    setPlace(p);
  };

  return (
    <Sheet title="Новая цель" onClose={onClose}>
      <Field label="Название цели" value={name} onChangeText={setName} />
      {places ? <PlacePicker options={listed} value={place} onChange={choose} onOther={() => setAddingPlace(true)} /> : null}
      <Field label={`Сумма цели, ${mark(place?.currency ?? "USD")}`} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      {place ? <Text style={styles.note}>{IN_PLACE_NOTE}</Text> : null}
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Добавить цель" onPress={add} disabled={create.isPending} />
      {addingPlace && <NewAccountSheet onClose={() => setAddingPlace(false)} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: { paddingBottom: space.sm },
  picker: { gap: space.xs },
  heading: { ...type.caption, color: color.fg.muted },
  place: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  placeName: { ...type.body, color: color.fg.default, flex: 1 },
  placeBalance: { ...type.body, color: color.list.value, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.muted },
});
