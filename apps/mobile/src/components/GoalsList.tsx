import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { formatDollars, goalPercent } from "../format";
import { Glass } from "./Glass";
import { ProgressBar } from "./ProgressBar";

const { color, space, type } = tokens;

type Props = { goals: TodayDto["goals"]; onOpenGoal: (id: number) => void; onOpenAll: () => void };

/** Every goal in one card: the total on top (opens all goals), then each goal (opens its own window). */
export function GoalsList({ goals, onOpenGoal, onOpenAll }: Props) {
  const saved = goals.reduce((s, g) => s + g.saved, 0);
  const target = goals.reduce((s, g) => s + g.target, 0);
  const total = `${formatDollars(saved)} из ${formatDollars(target)}`;
  return (
    <Glass style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Цели: ${total}`} onPress={onOpenAll} style={styles.line}>
        <Text style={styles.caption}>Цели</Text>
        <Text style={styles.caption}>{total}</Text>
      </Pressable>
      {goals.map((g) => {
          const percent = goalPercent(g.saved, g.target);
          const amount = `${formatDollars(g.saved)} · ${percent}%`;
          return (
            <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`${g.name}: ${amount}`} onPress={() => onOpenGoal(g.id)} style={styles.goal}>
              <View style={styles.line}>
                <Text style={styles.name} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={styles.amount}>{amount}</Text>
              </View>
              <ProgressBar percent={percent} />
            </Pressable>
          );
        })}
    </Glass>
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
