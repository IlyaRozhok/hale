import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { LAYOUT } from "./layout";

const { color, radius, space, touchMin } = tokens;

/** Same geometry as the loaded screen, so nothing jumps when data arrives: the date, the limit card, the phrase, the runway. */
export function TodaySkeleton() {
  return (
    <View testID="today-skeleton" style={styles.root} accessibilityLabel="Загрузка">
      <View style={styles.date}>
        <View style={[styles.bar, { width: 160, height: LAYOUT.note }]} />
      </View>
      <Glass style={styles.card}>
        <View style={[styles.bar, { width: 120, height: LAYOUT.eyebrow }]} />
        <View style={[styles.bar, { width: 220, height: LAYOUT.amount }]} />
        <View style={[styles.bar, { width: 150, height: LAYOUT.note }]} />
      </Glass>
      <View style={[styles.bar, { width: 240, height: LAYOUT.note }]} />
      <View style={[styles.bar, { height: LAYOUT.runway }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  date: { minHeight: touchMin, justifyContent: "center" },
  card: { gap: space.xs, paddingVertical: space.lg },
  bar: { backgroundColor: color.surface.raised, borderRadius: radius.md },
});
