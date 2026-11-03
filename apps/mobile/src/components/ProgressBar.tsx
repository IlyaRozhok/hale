import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius } = tokens;

/** A thin bar; the percent is also spoken, so progress is not only a shape. */
export function ProgressBar({ percent }: { percent: number }) {
  return (
    <View accessible accessibilityLabel={`Прогресс: ${percent}%`} style={styles.track}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: radius.full, backgroundColor: color.data.grid, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: color.data.actual },
});
