import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

const { color, space, touchMin, type } = tokens;

/** One quiet line that opens what it talks about; on glass, so the backdrop never runs under its text. */
export function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.press}>
      <Glass style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.arrow}>›</Text>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { minHeight: touchMin },
  row: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: 0,
  },
  label: { ...type.label, color: color.fg.default, flexShrink: 1 },
  arrow: { ...type.title, color: color.fg.subtle },
});
