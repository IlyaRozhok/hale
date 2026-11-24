import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { ErrorText } from "../ErrorText";
import { Glass } from "../Glass";

const { color, radius, space, touchMin, type } = tokens;

/**
 * What «Сегодня» shows when there is no data at all and the request failed: the words and «Повторить».
 *
 * Contract: `onRetry` asks for the data again; the screen swaps this card for the skeleton or the sections itself.
 */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Glass style={styles.stack}>
      <ErrorText>Не получилось загрузить данные. Проверьте связь и попробуйте ещё раз.</ErrorText>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
        <Text style={styles.buttonText}>Повторить</Text>
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  button: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  buttonText: { ...type.label, color: color.accent.fgOnAccent },
});
