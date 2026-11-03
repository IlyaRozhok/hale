import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

const { color, radius, space, type } = tokens;

/** Says how fresh the numbers are, without taking them away. */
export function StaleBanner({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Glass style={styles.box} accessible accessibilityRole="alert">
      {lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
    </Glass>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
  text: { ...type.label, color: color.fg.muted },
});
