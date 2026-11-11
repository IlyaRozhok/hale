import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { formatMoney } from "../format";

const { color, space, type } = tokens;

type Props = {
  label: string;
  /** Second, smaller line under the label (a due date, a footnote). */
  note?: string;
  kopecks: number;
  subtle?: boolean;
};

/** One label and amount row, in hryvnias. No dollar equivalent: a hryvnia total is not money in dollars. */
export function Line({ label, note, kopecks, subtle }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={[styles.label, subtle && styles.subtle]}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      <Text style={[styles.amount, subtle && styles.subtle]}>{formatMoney(kopecks)}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: space.xs },
  left: { flex: 1 },
  label: { ...type.body, color: color.fg.muted },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  subtle: { color: color.fg.subtle },
});
