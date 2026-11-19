import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CategoryDto } from "@hale/contracts";
import { useCategories, useReorderCategories } from "../api/queries";
import { categoryIconOf } from "../categoryIcon";
import { CategoryFormSheet } from "./CategoryFormSheet";
import { ErrorText } from "./ErrorText";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

/**
 * «Категории» from «Итоги» (task В5, variant А): the whole list in the order the operation's card offers it. A row
 * opens its name, icon and deletion; the arrows move it one place up or down; «Новая категория» adds one at the end.
 */
export function CategoriesSheet({ onClose }: { onClose: () => void }) {
  const categories = useCategories();
  const reorder = useReorderCategories();
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [adding, setAdding] = useState(false);
  const list = categories.data;

  const move = (from: number, by: -1 | 1) => {
    if (!list) return;
    const keys = list.map((c) => c.key);
    const to = from + by;
    [keys[from], keys[to]] = [keys[to]!, keys[from]!];
    reorder.mutate(keys);
  };

  return (
    <Sheet title="Категории" subtitle="Порядок — как в карточке операции" onClose={onClose}>
      {list === null ? (
        // An older server keeps the built-in list.
        <Text style={styles.note}>Свои категории появятся после обновления сервера.</Text>
      ) : list ? (
        <>
          <View style={styles.card}>
            {list.map((c, i) => (
              <View key={c.key} style={[styles.row, i > 0 && styles.divided]}>
                <Pressable testID="category-row" accessibilityRole="button" accessibilityLabel={c.name} onPress={() => setEditing(c)} style={styles.open}>
                  <Badge icon={categoryIconOf(c.key, list)} />
                  <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                </Pressable>
                <Arrow icon="up" label={`Выше: ${c.name}`} disabled={i === 0 || reorder.isPending} onPress={() => move(i, -1)} />
                <Arrow icon="down" label={`Ниже: ${c.name}`} disabled={i === list.length - 1 || reorder.isPending} onPress={() => move(i, 1)} />
              </View>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Новая категория" onPress={() => setAdding(true)} style={[styles.row, styles.open, styles.divided]}>
              <Badge icon="plus" />
              <Text style={styles.name}>Новая категория</Text>
            </Pressable>
          </View>
          {reorder.isError && <ErrorText>Не удалось сохранить порядок. Попробуйте ещё раз.</ErrorText>}
          <Text style={styles.note}>Нажмите на категорию, чтобы переименовать или удалить. «Возвраты» и «Без категории» служебные — их не удалить.</Text>
        </>
      ) : categories.isError ? (
        <ErrorText>Не получилось загрузить категории. Проверьте связь и попробуйте ещё раз.</ErrorText>
      ) : (
        <ActivityIndicator color={color.fg.muted} />
      )}
      {editing && <CategoryFormSheet category={editing} onClose={() => setEditing(null)} />}
      {adding && <CategoryFormSheet onClose={() => setAdding(false)} />}
    </Sheet>
  );
}

function Badge({ icon }: { icon: IconName }) {
  return (
    <View style={styles.badge}>
      <Icon name={icon} color={color.fg.muted} size={16} />
    </View>
  );
}

function Arrow({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.arrow}>
      <View style={disabled && styles.off}>
        <Icon name={icon} color={color.fg.muted} size={18} />
      </View>
    </Pressable>
  );
}

const BADGE = 28;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center" },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  open: { flex: 1, minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  badge: { width: BADGE, height: BADGE, borderRadius: radius.md, backgroundColor: color.surface.raised, alignItems: "center", justifyContent: "center" },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  arrow: { minWidth: touchMin - space.sm, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  off: { opacity: 0.3 },
  note: { ...type.caption, color: color.fg.muted },
});
