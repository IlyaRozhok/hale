import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";

const { color, space, touchMin, type } = tokens;

/**
 * The one way a window closes (Я6): the quiet word «Закрыть» at the top right, in every sheet and in Settings alike,
 * with no «×» and no «Понятно» of their own.
 */
export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onPress} style={styles.close}>
      <Text style={styles.closeText}>Закрыть</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.sm },
  closeText: { ...type.label, color: color.fg.muted },
});
