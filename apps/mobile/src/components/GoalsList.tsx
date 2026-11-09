import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { formatDollars, goalPercent } from "../format";
import { Glass } from "./Glass";
import { ProgressBar } from "./ProgressBar";

const { color, space, type } = tokens;

/** Every goal in one card: the total on top, then each with its amount, percent and a thin bar. Opens Plan. */
export function GoalsList({ goals, onPress }: { goals: TodayDto["goals"]; onPress: () => void }) {
  const saved = goals.reduce((s, g) => s + g.saved, 0);
  const target = goals.reduce((s, g) => s + g.target, 0);
  const total = `${formatDollars(saved)} из ${formatDollars(target)}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Цели: ${total}`} onPress={onPress}>
      <Glass style={styles.card}>
        <View style={styles.line}>
          <Text style={styles.caption}>Цели</Text>
          <Text style={styles.caption}>{total}</Text>
        </View>
        {goals.map((g) => {
          const percent = goalPercent(g.saved, g.target);
          return (
            <View key={g.id} style={styles.goal}>
              <View style={styles.line}>
                <Text style={styles.name} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={styles.amount}>{`${formatDollars(g.saved)} · ${percent}%`}</Text>
              </View>
              <ProgressBar percent={percent} />
            </View>
          );
        })}
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  goal: { gap: space.xs },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md },
  caption: { ...type.caption, color: color.fg.subtle, fontVariant: ["tabular-nums"] },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  amount: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
});
