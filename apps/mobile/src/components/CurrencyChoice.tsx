import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Chip } from "./Chip";

const { space } = tokens;

const CHOICES = [
  { code: "UAH", label: "₴" },
  { code: "USD", label: "$" },
];

/** Payments and incomes are in hryvnias or dollars. */
export function CurrencyChoice({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <View style={styles.row}>
      {CHOICES.map((c) => (
        <Chip key={c.code} role="radio" label={c.label} selected={value === c.code} onPress={() => onChange(c.code)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
