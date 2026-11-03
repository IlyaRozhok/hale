import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";

const { color, type } = tokens;

/** Something went wrong: the one calm red in the app. The words say what, the colour only draws the eye. */
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

const styles = StyleSheet.create({ text: { ...type.body, color: color.status.danger } });
