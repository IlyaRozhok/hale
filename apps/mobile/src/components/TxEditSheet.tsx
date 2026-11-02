import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";
import type { TransactionDto, TransactionPatch } from "@tablo/contracts";
import { useEditTransaction } from "../api/queries";
import { SPEND_CATEGORIES, TYPE_CHOICES, categoryLabel, typeLabel } from "../labels";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

type Props = { tx: TransactionDto; onClose: () => void };

/** Change the type or the category with one tap; "apply to similar" is on unless turned off. */
export function TxEditSheet({ tx, onClose }: Props) {
  const edit = useEditTransaction();
  const [similar, setSimilar] = useState(true);
  const [failed, setFailed] = useState(false);

  const save = (patch: Pick<TransactionPatch, "type" | "category">) => {
    setFailed(false);
    edit.mutate(
      { id: tx.id, patch: { ...patch, applyToSimilar: similar } },
      { onSuccess: onClose, onError: () => setFailed(true) },
    );
  };

  return (
    <Sheet title={tx.counterName ?? tx.description} subtitle="Изменить тип или категорию" onClose={onClose}>
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
      {failed && <Text style={styles.text}>Не удалось сохранить. Попробуйте ещё раз.</Text>}
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

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  text: { ...type.body, color: color.fg.default, flexShrink: 1 },
  heading: { ...type.label, color: color.fg.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
