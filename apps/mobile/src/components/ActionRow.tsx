import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

/** One quiet line that opens what it talks about; it should not compete with the cards. */
export function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.xl,
  },
  label: { ...type.label, color: color.fg.muted, flexShrink: 1 },
  arrow: { ...type.title, color: color.fg.subtle },
});
