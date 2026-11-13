import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TransactionDto, TransactionPatch } from "@hale/contracts";
import { useEditTransaction, useSetCardCash, useSimilarCount } from "../api/queries";
import { dayMonth, formatMoney, formatSignedMoney, formatSignedOriginal, operationsText, two } from "../format";
import { AmountForm } from "./AmountForm";
import { SPEND_CATEGORIES, accountLabel, answerText, categoryLabel, typeChips, typeLabel } from "../labels";
import { ErrorText } from "./ErrorText";
import { ActionRow } from "./ActionRow";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onClose: () => void; /** Present when the row is a transfer to someone. */ onAnswer?: () => void };

/** A moment in the device's local time: "10 ноя, 14:32". */
function dateTime(iso: string): string {
  const d = new Date(iso);
  const { day, month } = dayMonth(`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`);
  return `${day} ${month}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Which operation this is: the figure its list row shows, when it happened and on which account. */
function facts(tx: TransactionDto): string {
  const amount = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  return [amount, dateTime(tx.occurredAt), accountLabel(tx.accountKind)].filter((part) => part !== null).join(" · ");
}

/**
 * The operation on top, then its category and type, each changed with one tap; "apply to similar" is on
 * unless turned off. The rare types wait behind "Ещё".
 */
export function TxEditSheet({ tx, onClose, onAnswer }: Props) {
  const edit = useEditTransaction();
  const [similar, setSimilar] = useState(true);
  const [allTypes, setAllTypes] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = useSimilarCount(tx.id, undefined, similar);

  const save = (patch: Pick<TransactionPatch, "type" | "category">) => {
    setFailed(false);
    edit.mutate(
      { id: tx.id, patch: { ...patch, applyToSimilar: similar } },
      { onSuccess: onClose, onError: () => setFailed(true) },
    );
  };

  const title = tx.counterName ?? tx.description;
  const types = typeChips(tx.amount, tx.type);

  return (
    <Sheet title={title} subtitle={facts(tx)} onClose={onClose}>
      {tx.description !== "" && tx.description !== title && <Text style={styles.note}>{tx.description}</Text>}
      {onAnswer && <ActionRow label={`Что это за перевод: ${answerText(tx.recipientLabel)}`} onPress={onAnswer} />}
      {tx.cashOut !== null && <CardCash tx={tx} cashOut={tx.cashOut} />}
      <Text style={styles.heading}>Категория</Text>
      <View style={styles.chips}>
        {SPEND_CATEGORIES.map((c) => (
          <Chip key={c} label={categoryLabel(c)} selected={tx.category === c} disabled={edit.isPending} onPress={() => save({ category: c })} />
        ))}
      </View>
      <Text style={styles.heading}>Тип</Text>
      <View style={styles.chips}>
        {(allTypes ? [...types.shown, ...types.rest] : types.shown).map((t) => (
          <Chip key={t} label={typeLabel(t)} selected={tx.type === t} disabled={edit.isPending} onPress={() => save({ type: t })} />
        ))}
        {!allTypes && <Chip label="Ещё" onPress={() => setAllTypes(true)} />}
      </View>
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.text}>Применить к похожим</Text>
          {similar && count.data !== undefined && <Text style={styles.note}>{`Изменится ${operationsText(count.data)}`}</Text>}
        </View>
        <Switch
          accessibilityLabel="Применить к похожим"
          value={similar}
          onValueChange={setSimilar}
          trackColor={{ false: color.data.track, true: color.accent.default }}
          thumbColor={color.fg.default}
        />
      </View>
    </Sheet>
  );
}

/** A transfer to the owner's card at another bank: how much of it was taken out as cash. */
function CardCash({ tx, cashOut }: { tx: TransactionDto; cashOut: number }) {
  const set = useSetCardCash();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  // The sheet was opened with a snapshot of the row: what was saved shows here at once.
  const [shown, setShown] = useState(cashOut);
  const full = Math.abs(tx.amountUah ?? tx.amount);
  const save = (amount: number) => {
    setFailed(false);
    set.mutate(
      { id: tx.id, amount },
      {
        onSuccess: () => {
          setShown(amount);
          setEditing(false);
        },
        onError: () => setFailed(true),
      },
    );
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.text}>{shown > 0 ? `Снял наличными: ${formatMoney(shown)}` : "Наличными не снимал"}</Text>
      {editing ? (
        <AmountForm label="Сколько снял" max={full} disabled={set.isPending} onSave={save} />
      ) : (
        <View style={styles.chips}>
          <Link label="Изменить сумму" onPress={() => setEditing(true)} />
          {shown > 0 && <Link label="Не снимал" onPress={() => save(0)} />}
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
  note: { ...type.caption, color: color.fg.muted },
  switchText: { flex: 1 },
  link: { minHeight: touchMin, justifyContent: "center" },
  linkText: { ...type.label, color: color.accent.default },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  text: { ...type.body, color: color.fg.default, flexShrink: 1 },
  heading: { ...type.label, color: color.fg.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
