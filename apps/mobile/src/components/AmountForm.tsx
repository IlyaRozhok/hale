import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { parseBalance } from "../format";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";

const { space } = tokens;

type Props = {
  label: string;
  /** Largest allowed amount in kopecks; the server checks it in any case. */
  max?: number;
  disabled?: boolean;
  onSave: (kopecks: number) => void;
};

/** One amount in hryvnias and "Сохранить": nothing above `max`, nothing below zero. */
export function AmountForm({ label, max = Number.MAX_SAFE_INTEGER, disabled, onSave }: Props) {
  const [text, setText] = useState("");
  const kopecks = parseBalance(text);
  const tooMuch = kopecks !== null && kopecks > max;
  return (
    <View style={styles.stack}>
      <Field label={label} value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus />
      {tooMuch && <ErrorText>Не больше суммы перевода.</ErrorText>}
      <PrimaryButton label="Сохранить" disabled={disabled || kopecks === null || kopecks <= 0 || tooMuch} onPress={() => kopecks !== null && onSave(kopecks)} />
    </View>
  );
}

const styles = StyleSheet.create({ stack: { gap: space.md } });
