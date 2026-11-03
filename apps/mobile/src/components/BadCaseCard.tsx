import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";

/** A calm note about a hard moment: plain fill, plain text, no alarm. */
export function BadCaseCard({ text }: { text: string }) {
  return (
    <Glass>
      <Text style={styles.text}>{text}</Text>
    </Glass>
  );
}

const styles = StyleSheet.create({ text: { ...tokens.type.body, color: tokens.color.fg.default } });
