import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

type Props = { label: string; onPress: () => void; selected?: boolean; disabled?: boolean; role?: "button" | "radio" };

/** A pill button; the selected one is lighter and says so to assistive tech. */
export function Chip({ label, onPress, selected = false, disabled = false, role = "button" }: Props) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}
    >
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touchMin,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.surface.overlay,
  },
  selected: { backgroundColor: color.accent.default },
  disabled: { opacity: 0.6 },
  text: { ...type.label, color: color.fg.default },
  selectedText: { color: color.accent.fgOnAccent },
});
