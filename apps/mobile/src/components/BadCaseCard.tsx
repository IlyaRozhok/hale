import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

const { color, space, touchMin, type } = tokens;

type Props = {
  text: string;
  /** Present when the note is about an open loan. */
  onRepay?: () => void;
  /** Present on a loan entered by hand, which may have been a mistake. */
  onDelete?: () => void;
};

/** Removing a loan is only for a mistaken entry, so it asks first. */
export function askDeleteLoan(text: string, onDelete: () => void): void {
  Alert.alert("Удалить ошибочную запись?", `${text}. Если займ настоящий, отметьте его погашенным.`, [
    { text: "Оставить", style: "cancel" },
    { text: "Удалить", style: "destructive", onPress: onDelete },
  ]);
}

/** A calm note about a hard moment: one compact row, plain text, no alarm. */
export function BadCaseCard({ text, onRepay, onDelete }: Props) {
  return (
    <Glass style={styles.row}>
      <Text style={styles.text}>{text}</Text>
      {onDelete ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Удалить: ${text}`} onPress={() => askDeleteLoan(text, onDelete)} style={styles.action}>
          <Text style={styles.deleteText}>Удалить</Text>
        </Pressable>
      ) : null}
      {onRepay ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Погасил: ${text}`} onPress={onRepay} style={styles.action}>
          <Text style={styles.actionText}>Погасил</Text>
        </Pressable>
      ) : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  text: { ...type.label, color: color.fg.muted, flex: 1 },
  action: { minHeight: touchMin, justifyContent: "center" },
  actionText: { ...type.label, color: color.fg.default },
  deleteText: { ...type.label, color: color.fg.muted },
});
