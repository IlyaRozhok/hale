import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CashCardAnswer, TodayDto } from "@hale/contracts";
import { formatDollars, shiftDate } from "../format";
import { AmountForm } from "./AmountForm";
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
  /** «Да, $2,700»: the expected amount arrived. */
  onConfirmUsdc: (eventId: number) => void;
  /** «Пришло другое»: ask how much came; `expectedAmount` in cents is what to fill in. */
  onUsdcOther: (eventId: number, expectedAmount: number) => void;
  onMatchUsdc: (eventId: number, transactionId: number) => void;
  onDismissUsdc: (transactionId: number) => void;
  onCashFromWallet: (transactionId: number) => void;
  onCashCard: (transactionId: number, answer: CashCardAnswer) => void;
  /** «Это оплата?» answered yes: the operation pays the payment, as in the «Оплачено» sheet. */
  onPayWith: (paymentId: number, transactionId: number) => void;
  onNotPaidBy: (paymentId: number, transactionId: number) => void;
  onSetDate: (eventId: number, date: string) => void;
  onOpenActivity: () => void;
  onLabelRecipient: (counterKey: string) => void;
};

export function QuestionCard({
  question,
  today,
  onConfirmUsdc,
  onUsdcOther,
  onMatchUsdc,
  onDismissUsdc,
  onCashFromWallet,
  onCashCard,
  onPayWith,
  onNotPaidBy,
  onSetDate,
  onOpenActivity,
  onLabelRecipient,
}: Props) {
  const eventId = eventIdOf(question.id);
  const text = <Text style={styles.text}>{question.text}</Text>;

  if (question.kind === "usdc_arrived" && eventId !== null) {
    const expected = question.expectedAmount;
    // An older server sends no amount: then the one answer of before.
    if (expected === undefined || !(expected > 0)) {
      return (
        <Glass style={styles.stack}>
          {text}
          <Choice label="Да, пришло" onPress={() => onConfirmUsdc(eventId)} />
        </Glass>
      );
    }
    return (
      <Glass style={styles.stack}>
        {text}
        <View style={styles.choices}>
          <Choice label={`Да, ${formatDollars(expected)}`} onPress={() => onConfirmUsdc(eventId)} />
          <Choice label="Пришло другое" onPress={() => onUsdcOther(eventId, expected)} />
        </View>
      </Glass>
    );
  }
  if (question.kind === "usdc_match") {
    const transactionId = Number(question.id.split(":")[2]);
    if (eventId !== null && Number.isInteger(transactionId) && transactionId > 0) {
      return (
        <Glass style={styles.stack}>
          {text}
          <View style={styles.choices}>
            <Choice label="Да, вывод с Binance" onPress={() => onMatchUsdc(eventId, transactionId)} />
            <Choice label="Нет" onPress={() => onDismissUsdc(transactionId)} />
          </View>
        </Glass>
      );
    }
  }
  if (question.kind === "cash_source") {
    // "cash_source:<deposit>:<USDC event, 0 when there is none to match>"
    const [, txPart, eventPart] = question.id.split(":");
    const transactionId = Number(txPart);
    const usdcEvent = Number(eventPart);
    if (Number.isInteger(transactionId) && transactionId > 0) {
      return (
        <Glass style={styles.stack}>
          {text}
          <View style={styles.choices}>
            <Choice label="Из моих наличных" onPress={() => onCashFromWallet(transactionId)} />
            {Number.isInteger(usdcEvent) && usdcEvent > 0 && <Choice label="Вывод с Binance" onPress={() => onMatchUsdc(usdcEvent, transactionId)} />}
            <Choice label="Другое" onPress={() => onDismissUsdc(transactionId)} />
          </View>
        </Glass>
      );
    }
  }
  if (question.kind === "payment_paid") {
    // "payment_paid:<payment>:<operation>"
    const transactionId = Number(question.id.split(":")[2]);
    if (eventId !== null && Number.isInteger(transactionId) && transactionId > 0) {
      return (
        <Glass style={styles.stack}>
          <View style={styles.lines}>
            {text}
            {question.detail ? <Text style={styles.hint}>{question.detail}</Text> : null}
          </View>
          <View style={styles.choices}>
            <Choice label="Да" onPress={() => onPayWith(eventId, transactionId)} />
            <Choice label="Нет" onPress={() => onNotPaidBy(eventId, transactionId)} />
          </View>
        </Glass>
      );
    }
  }
  if (question.kind === "cash_card" && eventId !== null) {
    return <CashCardQuestion text={question.text} onAnswer={(a) => onCashCard(eventId, a)} />;
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
  if (question.kind === "recipient_label") {
    const counterKey = question.id.split(":")[1];
    if (counterKey) {
      return (
        <Pressable accessibilityRole="button" onPress={() => onLabelRecipient(counterKey)} style={styles.whole}>
          <Glass style={styles.stack}>
            {text}
            <Text style={styles.hint}>Что это за перевод? Нажмите, чтобы ответить</Text>
          </Glass>
        </Pressable>
      );
    }
  }
  return (
    <Pressable accessibilityRole="button" onPress={onOpenActivity} style={styles.whole}>
      <Glass>{text}</Glass>
    </Pressable>
  );
}

/** "Снял наличными?" about a transfer to the owner's card at another bank: yes, part of it (how much), no. */
function CashCardQuestion({ text, onAnswer }: { text: string; onAnswer: (a: CashCardAnswer) => void }) {
  const [part, setPart] = useState(false);
  return (
    <Glass style={styles.stack}>
      <Text style={styles.text}>{text}</Text>
      {part ? (
        <AmountForm label="Сколько снял" onSave={(amount) => onAnswer({ answer: "part", amount })} />
      ) : (
        <View style={styles.choices}>
          <Choice label="Да" onPress={() => onAnswer({ answer: "yes" })} />
          <Choice label="Да, часть" onPress={() => setPart(true)} />
          <Choice label="Нет" onPress={() => onAnswer({ answer: "no" })} />
        </View>
      )}
    </Glass>
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
  hint: { ...type.body, color: color.fg.muted },
  lines: { gap: space.xs },
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
