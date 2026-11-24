import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { longDate } from "../../format";
import { Icon } from "../Icon";

const { color, radius, space, touchMin, type } = tokens;

/**
 * The header of «Сегодня»: the date on the left, the bell with the open questions and the profile button on the right.
 *
 * Contract: `questions` is the number of questions still waiting (answers hidden while their call runs are already
 * left out by the screen). With none the bell keeps its place but is not a button (task Я9). The header owns no state:
 * the screen opens the questions' list and the settings.
 */
export function TodayHeader({
  date,
  questions,
  onOpenQuestions,
  onOpenSettings,
}: {
  /** The Kyiv day the data is for, ISO. */
  date: string;
  questions: number;
  onOpenQuestions: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.date}>{longDate(date)}</Text>
      <View style={styles.headerButtons}>
        {/* Task Я9: with nothing to answer the bell keeps its place (the header does not jump) but is not a button. */}
        {questions > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Вопросы: ${questions}`} onPress={onOpenQuestions} style={styles.profile}>
            <Icon name="bell" color={color.fg.muted} size={20} />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{questions}</Text>
            </View>
          </Pressable>
        ) : (
          <View accessible accessibilityLabel="Вопросов нет" style={styles.profile}>
            <Icon name="bell" color={color.fg.muted} size={20} />
          </View>
        )}
        <ProfileButton onPress={onOpenSettings} />
      </View>
    </View>
  );
}

/** The header when the data did not load: only the profile button, so settings and «Выйти» stay reachable. */
export function TodayHeaderProfileOnly({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={[styles.header, styles.headerEnd]}>
      <ProfileButton onPress={onOpenSettings} />
    </View>
  );
}

/** Task ЯМ7 (the owner's «Все А»): settings open from the profile button in the header, not from «План». */
function ProfileButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={onPress} style={styles.profile}>
      <Icon name="user" color={color.fg.muted} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  headerEnd: { justifyContent: "flex-end" },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: space.sm },
  date: { ...type.label, color: color.fg.default, flexShrink: 1 },
  profile: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: color.glass.row },
  badge: {
    position: "absolute",
    top: space.xs,
    right: space.xs,
    minWidth: space.lg,
    height: space.lg,
    paddingHorizontal: space.xs,
    borderRadius: radius.full,
    backgroundColor: color.accent.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...type.caption, fontWeight: "500", color: color.accent.fgOnSignal },
});
