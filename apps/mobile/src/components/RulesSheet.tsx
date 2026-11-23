import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { RuleDto } from "@hale/contracts";
import { useCategoryList, useDeleteRule, useRules } from "../api/queries";
import { firstCapital, operationsText, pluralIndex } from "../format";
import { answerText, categoryName, type CategoryList, typeLabel } from "../labels";
import { ErrorText } from "./ErrorText";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

/** What a rule does, then how many operations follow it; a category as the server names it (В5). */
export const ruleSummary = (r: RuleDto, list?: CategoryList): string => {
  const does = r.label ? answerText(r.label) : r.category ? `${typeLabel(r.type)} · ${categoryName(r.category, list)}` : typeLabel(r.type);
  return `${does} · ${operationsText(r.count)}`;
};

/** The owner's rules: what each matches and does; one can be deleted after a confirmation. */
export function RulesSheet({ onClose }: { onClose: () => void }) {
  const rules = useRules();
  const remove = useDeleteRule();
  const list = useCategoryList();

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
        <Text style={styles.muted}>Правил пока нет. Они появляются, когда после смены категории или типа вы выбираете «Да, всегда» или отвечаете, что это за перевод.</Text>
      )}
      {rules.data?.map((r) => {
        // Shown with a capital letter; the rule itself keeps the bank's text.
        const title = firstCapital(r.title);
        return (
          <View key={r.id} style={styles.row}>
            <View style={styles.what}>
              <Text style={styles.text}>{title}</Text>
              <Text style={styles.muted}>{ruleSummary(r, list)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Удалить правило «${title}»`}
              disabled={remove.isPending}
              onPress={() => confirm(r)}
              style={styles.delete}
            >
              <Text style={styles.deleteText}>Удалить</Text>
            </Pressable>
          </View>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  what: { flex: 1, gap: space.xs },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  delete: { minHeight: touchMin, justifyContent: "center" },
  // Quiet: red is only for going over the limit and for errors (Я6); the alert still asks first.
  deleteText: { ...type.label, color: color.fg.muted },
});
