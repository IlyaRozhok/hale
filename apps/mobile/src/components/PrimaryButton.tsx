import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, touchMin, type } = tokens;

/** The one main action of a window. */
export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.accent.default },
  disabled: { opacity: 0.6 },
  text: { ...type.label, color: color.accent.fgOnAccent },
});
