import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color, space, touchMin, type } = tokens;

/** One part of the plan: its name and where it stands. Tapping opens the details. */
export function SummaryRow({ label, detail, onPress }: { label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} onPress={onPress} style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  text: { flex: 1 },
  label: { ...type.body, color: color.fg.default },
  detail: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  arrow: { ...type.title, color: color.fg.subtle },
});
