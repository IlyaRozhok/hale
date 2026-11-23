import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

type Props = { label: string; icon: IconName; selected?: boolean; disabled?: boolean; onPress: () => void };

/**
 * A category to pick: its icon and name in one colour; the chosen one is inverted, as the other chips. The same in
 * the operation's card and in a cash purchase (task Я7).
 */
export function CategoryChip({ label, icon, selected = false, disabled = false, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillOn, disabled && styles.disabled]}
    >
      <Icon name={icon} color={selected ? color.accent.fgOnAccent : color.fg.muted} size={16} />
      <Text style={[styles.pillText, selected && styles.pillTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.full,
    backgroundColor: color.surface.overlay,
  },
  pillOn: { backgroundColor: color.accent.default },
  pillText: { ...type.label, color: color.fg.default },
  pillTextOn: { color: color.accent.fgOnAccent },
  disabled: { opacity: 0.6 },
});
