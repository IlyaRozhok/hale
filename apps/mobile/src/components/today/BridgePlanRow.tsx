import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { formatMoney } from "../../format";
import { Icon } from "../Icon";

const { color, space, touchMin, type } = tokens;

/**
 * The «План до дохода» row under the phrase of the day, in the shortage mode with a confirmed plan.
 *
 * Contract: the screen decides when the row is shown (`state.mode === "bridge"` and the plan is confirmed) and what
 * `onPress` opens (the plan's sheet); the row only shows the plan's daily amount.
 */
export function BridgePlanRow({ dailyLimit, onPress }: { dailyLimit: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`План до дохода: ${formatMoney(dailyLimit)} в день`}
      onPress={onPress}
      style={styles.planRow}
    >
      <Icon name="route" color={color.fg.muted} size={18} />
      <Text style={styles.planText}>План до дохода</Text>
      <Text style={styles.planAmount}>{`${formatMoney(dailyLimit)} в день`}</Text>
      <Icon name="chevron" color={color.fg.subtle} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  planRow: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xs },
  planText: { ...type.body, color: color.fg.default, flex: 1 },
  planAmount: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
});
