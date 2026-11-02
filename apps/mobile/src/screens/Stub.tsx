import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";

/** Placeholder for tabs that arrive in Task 16. */
export function Stub({ title }: { title: string }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Скоро здесь появится этот раздел.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.surface.base, alignItems: "center", justifyContent: "center", gap: tokens.space.sm },
  title: { ...tokens.type.title, color: tokens.color.fg.default },
  note: { ...tokens.type.body, color: tokens.color.fg.muted },
});
