import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

const { color, space, touchMin, type } = tokens;

/** A calm note about a hard moment: one compact row, plain text, no alarm. */
export function BadCaseCard({ text }: { text: string }) {
  return (
    <Glass style={styles.row}>
      <Text style={styles.text}>{text}</Text>
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
});
