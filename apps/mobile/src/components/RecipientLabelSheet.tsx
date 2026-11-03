import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { useLabelRecipient } from "../api/queries";
import { LABEL_CHOICES } from "../labels";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

type Props = { counterKey: string; name?: string; onClose: () => void; onLabeled?: () => void; onEditType?: () => void };

/** "Кто это?": one tap labels the recipient everywhere. */
export function RecipientLabelSheet({ counterKey, name, onClose, onLabeled, onEditType }: Props) {
  const label = useLabelRecipient();
  const [failed, setFailed] = useState(false);
  return (
    <Sheet title="Кто это?" subtitle={name} onClose={onClose}>
      {failed && <Text style={styles.text}>Не удалось сохранить. Попробуйте ещё раз.</Text>}
      <View style={styles.chips}>
        {LABEL_CHOICES.map((c) => (
          <Chip
            key={c.label}
            label={c.text}
            disabled={label.isPending}
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
          />
        ))}
      </View>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
