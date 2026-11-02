import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";

const { color, radius, space, type } = tokens;

/** Says how fresh the numbers are, without taking them away. */
export function StaleBanner({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.box} accessibilityRole="text">
      {lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: color.surface.raised, borderRadius: radius.lg, padding: space.md, gap: space.xs },
  text: { ...type.label, color: color.fg.muted },
});
