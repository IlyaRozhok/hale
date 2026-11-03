import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

type Props = { text: string; /** Present when the owner may remove what the note is about. */ onRemove?: () => void };

/** A calm note about a hard moment: one compact row, plain text, no alarm. */
export function BadCaseCard({ text, onRemove }: Props) {
  const ask = () =>
    Alert.alert("Убрать займ?", text, [
      { text: "Оставить", style: "cancel" },
      { text: "Убрать", style: "destructive", onPress: onRemove },
    ]);
  return (
    <View style={styles.row}>
      <Text style={styles.text}>{text}</Text>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Убрать: ${text}`} onPress={ask} style={styles.remove}>
          <Text style={styles.removeText}>Убрать</Text>
        </Pressable>
      ) : null}
    </View>
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
    borderRadius: radius.xl,
    backgroundColor: color.surface.inset,
  },
  text: { ...type.label, color: color.fg.muted, flex: 1 },
  remove: { minHeight: touchMin, justifyContent: "center" },
  removeText: { ...type.label, color: color.fg.default },
});
