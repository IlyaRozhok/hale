import type { Ref } from "react";
import { StyleSheet, TextInput, type TextInputInstance, type TextInputProps } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

/** A labelled single-line input on its own fill. The label is the accessibility label and the placeholder. */
export function Field({ label, ...rest }: TextInputProps & { label: string; ref?: Ref<TextInputInstance> }) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={color.fg.subtle}
      autoCorrect={false}
      {...rest}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: touchMin,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.field.fill,
    color: color.fg.default,
    ...type.body,
  },
});
