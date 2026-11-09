import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { categoryIcon } from "../categoryIcon";
import { SPEND_CATEGORIES, categoryLabel } from "../labels";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

/** The categories of spending with their badges; one tap picks one. */
export function CategorySheet({ onPick, onClose }: { onPick: (category: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Категория" onClose={onClose}>
      {SPEND_CATEGORIES.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="button"
          accessibilityLabel={categoryLabel(c)}
          onPress={() => {
            onPick(c);
            onClose();
          }}
          style={styles.row}
        >
          <View style={styles.badge}>
            <Icon name={categoryIcon({ type: "spend", category: c })} color={color.fg.muted} size={18} />
          </View>
          <Text style={styles.text}>{categoryLabel(c)}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  badge: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: color.surface.raised, alignItems: "center", justifyContent: "center" },
  text: { ...type.body, color: color.fg.default },
});
