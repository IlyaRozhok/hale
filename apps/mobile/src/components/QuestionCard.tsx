import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@tablo/tokens";
import type { TodayDto } from "@tablo/contracts";
import { shiftDate } from "../format";
import { Glass } from "./Glass";

const { color, radius, space, touchMin, type } = tokens;

type Question = TodayDto["questions"][number];

const DATE_CHOICES = [
  { label: "Через 3 дня", days: 3 },
  { label: "Через неделю", days: 7 },
  { label: "Через 2 недели", days: 14 },
];

/** The numeric part of ids like "usdc_arrived:12"; null when the id carries none. */
export function eventIdOf(id: string): number | null {
  const n = Number(id.split(":")[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type Props = {
  question: Question;
  today: string;
  onConfirmUsdc: (eventId: number) => void;
  onSetDate: (eventId: number, date: string) => void;
  onOpenActivity: () => void;
};

export function QuestionCard({ question, today, onConfirmUsdc, onSetDate, onOpenActivity }: Props) {
  const eventId = eventIdOf(question.id);
  const text = <Text style={styles.text}>{question.text}</Text>;

  if (question.kind === "usdc_arrived" && eventId !== null) {
    return (
      <Glass style={styles.stack}>
        {text}
        <Choice label="Да, пришло" onPress={() => onConfirmUsdc(eventId)} />
      </Glass>
    );
  }
  if (question.kind === "income_date" && eventId !== null) {
    return (
      <Glass style={styles.stack}>
        {text}
        <View style={styles.choices}>
          {DATE_CHOICES.map((c) => (
            <Choice key={c.days} label={c.label} onPress={() => onSetDate(eventId, shiftDate(today, c.days))} />
          ))}
        </View>
      </Glass>
    );
  }
  // Recipient questions are answered in the Activity tab (Task 16); an income date with no
  // event to attach to can only be set there too.
  return (
    <Pressable accessibilityRole="button" onPress={onOpenActivity} style={styles.whole}>
      <Glass>{text}</Glass>
    </Pressable>
  );
}

function Choice({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.choice}>
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  text: { ...type.body, color: color.fg.default },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: touchMin,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  choiceText: { ...type.label, color: color.accent.fgOnAccent },
  whole: { minHeight: touchMin, justifyContent: "center" },
});
