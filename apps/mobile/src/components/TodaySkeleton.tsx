import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { LAYOUT } from "./layout";

const { color, radius, space } = tokens;

/** Same geometry as the loaded screen, so nothing jumps when data arrives. */
export function TodaySkeleton() {
  return (
    <View testID="today-skeleton" style={styles.root} accessibilityLabel="Загрузка">
      <Glass style={styles.header}>
        <View style={[styles.bar, { width: 120, height: LAYOUT.eyebrow }]} />
        <View style={[styles.bar, { width: 220, height: LAYOUT.amount }]} />
        <View style={[styles.bar, { width: 150, height: LAYOUT.note }]} />
        <View style={{ height: LAYOUT.pool }} />
      </Glass>
      <Glass style={{ height: LAYOUT.goals }}>
        <View />
      </Glass>
      <Glass style={{ height: LAYOUT.upcoming }}>
        <View />
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  header: { gap: space.xs },
  bar: { backgroundColor: color.surface.raised, borderRadius: radius.md },
});
