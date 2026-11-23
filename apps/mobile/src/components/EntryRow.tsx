import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Icon } from "./Icon";

const { color, space, touchMin, type } = tokens;

type Props = {
  title: string;
  /** The quiet line under the name: its figures, as «₴350, каждый месяц, 6 числа». */
  detail?: string;
  /** Anything else under the name, such as a goal's progress. */
  children?: ReactNode;
  /** Opens its form, where it is changed or deleted (ЯМ5). */
  onPress: () => void;
};

/** Deleting from the plan changes the limit, so it asks first. */
export function askDelete(title: string, note: string, onDelete: () => void): void {
  Alert.alert(`Удалить: ${title}?`, note, [
    { text: "Оставить", style: "cancel" },
    { text: "Удалить", style: "destructive", onPress: onDelete },
  ]);
}

/** One thing in the plan: what it is and its figures; a touch opens its form, the chevron says so. */
export function EntryRow({ title, detail, children, onPress }: Props) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Изменить: ${title}`} accessibilityHint={detail} onPress={onPress} style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {children}
      </View>
      <View testID="row-chevron">
        <Icon name="chevron" color={color.list.chevron} size={16} />
      </View>
    </Pressable>
  );
}

/** «Удалить платёж» under a form: quiet grey as in Я6, since red is only for going over the limit and for errors. */
export function DeleteAction({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  text: { flex: 1, gap: 2 },
  title: { ...type.body, color: color.fg.default },
  detail: { ...type.caption, color: color.fg.muted },
  action: { minHeight: touchMin, justifyContent: "center", alignSelf: "center" },
  actionText: { ...type.label, color: color.fg.muted },
});
