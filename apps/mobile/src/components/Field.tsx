import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

/** A labelled single-line input on an inset fill. The label is the accessibility label and the placeholder. */
export function Field({ label, ...rest }: TextInputProps & { label: string }) {
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
    backgroundColor: color.surface.inset,
    color: color.fg.default,
    ...type.body,
  },
});
