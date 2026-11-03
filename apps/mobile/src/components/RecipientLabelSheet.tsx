import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { useLabelRecipient, useRecipient } from "../api/queries";
import { formatMoney, shortDate } from "../format";
import { LABEL_CHOICES } from "../labels";
import { ErrorText } from "./ErrorText";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

type Props = { counterKey: string; name?: string; onClose: () => void; onLabeled?: () => void; onEditType?: () => void };

/** "Что это за перевод?": one tap answers for every transfer to this recipient; it can be changed later. */
export function RecipientLabelSheet({ counterKey, name, onClose, onLabeled, onEditType }: Props) {
  const label = useLabelRecipient();
  const summary = useRecipient(counterKey).data;
  const [failed, setFailed] = useState(false);
  return (
    <Sheet title="Что это за перевод?" subtitle={name} onClose={onClose}>
      {summary && (
        <Text style={styles.context}>
          Переводов: {summary.count}, всего {formatMoney(summary.total)}, последний {shortDate(summary.lastOn)}
        </Text>
      )}
      <Text style={styles.context}>Ответ относится ко всем переводам этому получателю.</Text>
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      {LABEL_CHOICES.map((c) => {
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
