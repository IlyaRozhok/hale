import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { RuleDto } from "@hale/contracts";
import { useDeleteRule, useRules } from "../api/queries";
import { operationsText, pluralIndex } from "../format";
import { answerText, categoryLabel, typeLabel } from "../labels";
import { ErrorText } from "./ErrorText";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

/** What a rule does, then how many operations follow it. */
export const ruleSummary = (r: RuleDto): string => {
  const does = r.label ? answerText(r.label) : r.category ? `${typeLabel(r.type)} · ${categoryLabel(r.category)}` : typeLabel(r.type);
  return `${does} · ${operationsText(r.count)}`;
};

/** The owner's rules: what each matches and does; one can be deleted after a confirmation. */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  const rules = useRules();
  const remove = useDeleteRule();

  const confirm = (r: RuleDto) =>
    Alert.alert(
      "Удалить правило?",
      r.count === 0
        ? "Сейчас под ним нет операций."
        : `${operationsText(r.count)} снова ${pluralIndex(r.count) === 0 ? "распознается" : "распознаются"} автоматически. Лимит пересчитается.`,
      [
      { text: "Отмена", style: "cancel" },
      { text: "Удалить", style: "destructive", onPress: () => remove.mutate(r.id) },
    ]);

  return (
    <Sheet title="Мои правила" subtitle="Как приложение распознаёт похожие операции" onClose={onClose}>
      {rules.isError && <ErrorText>Не получилось загрузить правила.</ErrorText>}
      {remove.isError && <ErrorText>Не удалось удалить. Попробуйте ещё раз.</ErrorText>}
      {rules.data?.length === 0 && (
        <Text style={styles.muted}>Правил пока нет. Они появляются, когда вы меняете операцию с «Применить к похожим» или отвечаете, что это за перевод.</Text>
      )}
      {rules.data?.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.what}>
            <Text style={styles.text}>{r.title}</Text>
            <Text style={styles.muted}>{ruleSummary(r)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Удалить правило «${r.title}»`}
            disabled={remove.isPending}
            onPress={() => confirm(r)}
            style={styles.delete}
          >
            <Text style={styles.deleteText}>Удалить</Text>
          </Pressable>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  what: { flex: 1, gap: space.xs },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  delete: { minHeight: touchMin, justifyContent: "center" },
  deleteText: { ...type.label, color: color.status.danger },
});
