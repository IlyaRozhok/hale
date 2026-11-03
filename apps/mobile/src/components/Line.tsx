import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { formatMoneyWithUsd } from "../format";

const { color, space, type } = tokens;

type Props = {
  label: string;
  /** Second, smaller line under the label (a due date, a footnote). */
  note?: string;
  kopecks: number;
  usdRate: number;
  subtle?: boolean;
};

/** One label and amount row, hryvnias with dollars alongside. */
export function Line({ label, note, kopecks, usdRate, subtle }: Props) {
  const { uah, usd } = formatMoneyWithUsd(kopecks, usdRate);
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={[styles.label, subtle && styles.subtle]}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, subtle && styles.subtle]}>{uah}</Text>
        {usd ? <Text style={styles.note}>{usd}</Text> : null}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: space.xs },
  left: { flex: 1 },
  right: { alignItems: "flex-end" },
  label: { ...type.body, color: color.fg.muted },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  subtle: { color: color.fg.subtle },
});
