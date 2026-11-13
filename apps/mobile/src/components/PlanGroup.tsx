import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { SummaryRow } from "./SummaryRow";

const { color, space, touchMin, type } = tokens;

/** Details that say there is nothing here: such rows fold away. */
const EMPTY = new Set(["нет", "открытых нет", "не задан"]);

/** `key` tells apart rows that may share a label, such as two balances with one name. */
export type PlanRow = { key?: string; label: string; detail?: string; onPress: () => void };

/** A quiet row after the parts, such as adding one more: shown text and its spoken name. */
export type PlanAction = { text: string; a11y: string; onPress: () => void };

/**
 * One calm group of the plan: its title, the parts that hold something, and one quiet "Ещё" row for
 * the parts that are empty, which unfolds them.
 */
export function PlanGroup({ title, rows, action, children }: { title: string; rows: PlanRow[]; action?: PlanAction; children?: ReactNode }) {
  return (
    <Glass style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
      <PlanRows rows={rows} />
      {action && (
        <Pressable accessibilityRole="button" accessibilityLabel={action.a11y} onPress={action.onPress} style={styles.more}>
          <Text style={styles.moreText}>{action.text}</Text>
        </Pressable>
      )}
    </Glass>
  );
}

/** The rows of a group: those that hold something, then "Ещё" for the empty ones. */
export function PlanRows({ rows }: { rows: PlanRow[] }) {
  const [unfolded, setUnfolded] = useState(false);
  const empty = rows.filter((r) => r.detail !== undefined && EMPTY.has(r.detail));
  const shown = unfolded ? rows : rows.filter((r) => !empty.includes(r));
  // Ordinary words go lower case inside the phrase; a name such as Binance stays as it is.
  const more = `Ещё: ${empty.map((r) => (/^[А-ЯЁ]/.test(r.label) ? r.label.toLowerCase() : r.label)).join(", ")}`;
  return (
    <>
      {shown.map((r) => (
        <SummaryRow key={r.key ?? r.label} label={r.label} detail={r.detail} onPress={r.onPress} />
      ))}
      {!unfolded && empty.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel={more} onPress={() => setUnfolded(true)} style={styles.more}>
          <Text style={styles.moreText}>{more}</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  title: { ...type.label, color: color.fg.subtle },
  more: { minHeight: touchMin, justifyContent: "center" },
  moreText: { ...type.caption, color: color.fg.subtle },
});
