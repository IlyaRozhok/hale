import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color, space, touchMin, type } = tokens;

type Props = { title: string; detail: string; onEdit: () => void; onDelete: () => void };

/** Deleting from the plan changes the limit, so it asks first. */
export function askDelete(title: string, note: string, onDelete: () => void): void {
  Alert.alert(`Удалить: ${title}?`, note, [
    { text: "Оставить", style: "cancel" },
    { text: "Удалить", style: "destructive", onPress: onDelete },
  ]);
}

/** One thing in the plan: what it is, its figures and what can be done with it. */
export function EntryRow({ title, detail, onEdit, onDelete }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <View style={styles.actions}>
        <TextAction label="Изменить" a11y={`Изменить: ${title}`} onPress={onEdit} />
        <TextAction label="Удалить" a11y={`Удалить: ${title}`} onPress={onDelete} />
      </View>
    </View>
  );
}

function TextAction({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2 },
  title: { ...type.body, color: color.fg.default },
  detail: { ...type.caption, color: color.fg.muted },
  actions: { flexDirection: "row", gap: space.xl },
  action: { minHeight: touchMin, justifyContent: "center" },
  actionText: { ...type.label, color: color.fg.muted },
});
