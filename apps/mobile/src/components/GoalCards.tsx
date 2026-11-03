import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { formatDollars, goalPercent } from "../format";
import { Glass } from "./Glass";
import { ProgressBar } from "./ProgressBar";

const { color, space, type } = tokens;

const SHOWN = 2;

/** The first two goals, side by side. The full list is on the Plan screen. */
export function GoalCards({ goals }: { goals: TodayDto["goals"] }) {
  return (
    <View style={styles.row}>
      {goals.slice(0, SHOWN).map((g) => {
        const percent = goalPercent(g.saved, g.target);
        return (
          <Glass key={g.id} style={styles.card}>
            <Text style={styles.name} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={styles.amount}>{formatDollars(g.saved)}</Text>
            <ProgressBar percent={percent} />
            <Text style={styles.name} numberOfLines={1}>{`${percent}% из ${formatDollars(g.target)}`}</Text>
          </Glass>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.md },
  card: { flex: 1, gap: space.xs, backgroundColor: color.surface.inset },
  name: { ...type.caption, color: color.fg.subtle },
  amount: { ...type.title, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
