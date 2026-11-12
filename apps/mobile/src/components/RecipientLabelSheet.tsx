import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { useLabelRecipient, useRecipient } from "../api/queries";
import { answerChoices, recipientLine } from "../labels";
import { ErrorText } from "./ErrorText";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

type Props = { counterKey: string; name?: string; onClose: () => void; onLabeled?: () => void; onEditType?: () => void };

/**
 * "Что это за перевод?": one tap answers for every transfer to this recipient; it can be changed later.
 * Three frequent answers are in sight, the rare ones wait behind "Другое".
 */
export function RecipientLabelSheet({ counterKey, name, onClose, onLabeled, onEditType }: Props) {
  const label = useLabelRecipient();
  const summary = useRecipient(counterKey).data;
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const answers = answerChoices(summary?.label ?? null);
  return (
    <Sheet title="Что это за перевод?" subtitle={recipientLine(name, summary)} onClose={onClose}>
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      {(all ? [...answers.shown, ...answers.rest] : answers.shown).map((c) => {
        const selected = summary?.label === c.label;
        return (
          <Pressable
            key={c.label}
            accessibilityRole="button"
            accessibilityLabel={c.text}
            accessibilityHint={c.effect}
            accessibilityState={{ selected, disabled: label.isPending }}
            disabled={label.isPending}
            style={[styles.choice, selected && styles.selected]}
            onPress={() => {
              setFailed(false);
              label.mutate(
                { counterKey, label: c.label },
                {
                  onSuccess: () => {
                    onLabeled?.();
                    onClose();
                  },
                  onError: () => setFailed(true),
                },
              );
            }}
          >
            <Text style={styles.text}>{c.text}</Text>
            <Text style={styles.effect}>{c.effect}</Text>
          </Pressable>
        );
      })}
      {!all && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Другое"
          accessibilityState={{ expanded: false }}
          style={styles.other}
          onPress={() => setAll(true)}
        >
          <Text style={styles.text}>Другое</Text>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      )}
      <Text style={styles.context}>Ответ относится ко всем переводам этому получателю.</Text>
      {onEditType && (
        <View style={styles.chips}>
          <Chip label="Изменить тип" disabled={label.isPending} onPress={onEditType} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  text: { ...type.body, color: color.fg.default },
  context: { ...type.caption, color: color.fg.muted },
  effect: { ...type.caption, color: color.fg.muted },
  choice: {
    minHeight: touchMin,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.surface.inset,
    backgroundColor: color.surface.inset,
  },
  selected: { borderColor: color.fg.default },
  other: { minHeight: touchMin, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  arrow: { ...type.title, color: color.fg.subtle },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
