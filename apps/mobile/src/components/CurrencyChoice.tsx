import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Segmented } from "./Segmented";

const CHOICES = [
  { key: "UAH", label: "₴" },
  { key: "USD", label: "$" },
];

/** Payments and incomes are in hryvnias or dollars. */
export function CurrencyChoice({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <Segmented testID="currency-choice" options={CHOICES} value={value} onChange={onChange} style={styles.control} />
  );
}

// Beside an amount: a touch target per sign, not the whole row.
const styles = StyleSheet.create({ control: { width: CHOICES.length * tokens.touchMin } });
