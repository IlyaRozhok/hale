import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto, TransactionPatch } from "@hale/contracts";
import { useEditTransaction, useSetCardCash, useSimilarCount } from "../api/queries";
import { formatMoney, operationsText } from "../format";
import { AmountForm } from "./AmountForm";
import { SPEND_CATEGORIES, TYPE_CHOICES, answerText, categoryLabel, typeLabel } from "../labels";
import { ErrorText } from "./ErrorText";
import { ActionRow } from "./ActionRow";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onClose: () => void; /** Present when the row is a transfer to someone. */ onAnswer?: () => void };

/** Change the type or the category with one tap; "apply to similar" is on unless turned off. */
export function TxEditSheet({ tx, onClose, onAnswer }: Props) {
  const edit = useEditTransaction();
  const [similar, setSimilar] = useState(true);
  const [failed, setFailed] = useState(false);
  const count = useSimilarCount(tx.id, undefined, similar);

  const save = (patch: Pick<TransactionPatch, "type" | "category">) => {
    setFailed(false);
    edit.mutate(
      { id: tx.id, patch: { ...patch, applyToSimilar: similar } },
      { onSuccess: onClose, onError: () => setFailed(true) },
    );
  };

  return (
    <Sheet title={tx.counterName ?? tx.description} subtitle="Изменить тип или категорию" onClose={onClose}>
      {onAnswer && <ActionRow label={`Что это за перевод: ${answerText(tx.recipientLabel)}`} onPress={onAnswer} />}
      <View style={styles.switchRow}>
        <Text style={styles.text}>Применить к похожим</Text>
        <Switch
          accessibilityLabel="Применить к похожим"
          value={similar}
          onValueChange={setSimilar}
          trackColor={{ false: color.data.track, true: color.accent.default }}
          thumbColor={color.fg.default}
        />
      </View>
      {similar && count.data !== undefined && <Text style={styles.muted}>{`Изменится ${operationsText(count.data)}`}</Text>}
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      {tx.cashOut !== null && <CardCash tx={tx} cashOut={tx.cashOut} />}
      <Text style={styles.heading}>Тип</Text>
      <View style={styles.chips}>
        {TYPE_CHOICES.map((t) => (
          <Chip key={t} label={typeLabel(t)} selected={tx.type === t} disabled={edit.isPending} onPress={() => save({ type: t })} />
        ))}
      </View>
      <Text style={styles.heading}>Категория</Text>
      <View style={styles.chips}>
        {SPEND_CATEGORIES.map((c) => (
          <Chip key={c} label={categoryLabel(c)} selected={tx.category === c} disabled={edit.isPending} onPress={() => save({ category: c })} />
        ))}
      </View>
    </Sheet>
  );
}

/** A transfer to the owner's card at another bank: how much of it was taken out as cash. */
function CardCash({ tx, cashOut }: { tx: TransactionDto; cashOut: number }) {
  const set = useSetCardCash();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const full = Math.abs(tx.amountUah ?? tx.amount);
  const save = (amount: number) => {
    setFailed(false);
    set.mutate({ id: tx.id, amount }, { onSuccess: () => setEditing(false), onError: () => setFailed(true) });
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.text}>{cashOut > 0 ? `Снял наличными: ${formatMoney(cashOut)}` : "Наличными не снимал"}</Text>
      {editing ? (
        <AmountForm label="Сколько снял" max={full} disabled={set.isPending} onSave={save} />
      ) : (
        <View style={styles.chips}>
          <Link label="Изменить сумму" onPress={() => setEditing(true)} />
          {cashOut > 0 && <Link label="Не снимал" onPress={() => save(0)} />}
        </View>
      )}
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  muted: { ...type.body, color: color.fg.muted },
  link: { minHeight: touchMin, justifyContent: "center" },
  linkText: { ...type.label, color: color.accent.default },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  text: { ...type.body, color: color.fg.default, flexShrink: 1 },
  heading: { ...type.label, color: color.fg.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
