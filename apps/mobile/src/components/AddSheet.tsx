import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { useToday } from "../api/queries";
import { dayMonth, formatMoney } from "../format";
import { CashOperationSheet, type CashMode } from "./CashOperationSheet";
import { Icon, type IconName } from "./Icon";
import { PaymentPaidSheet } from "./PaymentPaidSheet";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

type Payment = TodayDto["upcoming"][number];
type Step = { to: "menu" } | { to: "cash"; mode: CashMode } | { to: "payments" } | { to: "paid"; payment: Payment };

/** "Квартплата" due "2026-12-06" as "Квартплата · 6 дек". */
const nearest = (p: Payment) => {
  const { day, month } = dayMonth(p.dueOn);
  return `${p.name} · ${day} ${month}`;
};

/**
 * «Добавить»: the one window behind «+» for everything entered by hand (task Д5, variant А). A short list of
 * actions, each with one quiet line, leads into the forms that already exist: a cash operation, or «Оплачено» for
 * a payment from `GET /today`'s upcoming ones, nearest first. With none due the payment action is not shown.
 */
export function AddSheet({ onClose }: { onClose: () => void }) {
  const today = useToday();
  const [step, setStep] = useState<Step>({ to: "menu" });
  const upcoming = today.data?.upcoming ?? [];

  if (step.to === "cash") return <CashOperationSheet mode={step.mode} onClose={onClose} />;
  if (step.to === "paid" && today.data) return <PaymentPaidSheet payment={step.payment} today={today.data.date} onClose={onClose} />;

  if (step.to === "payments") {
    return (
      <Sheet title="Оплатил платёж" onClose={onClose}>
        {upcoming.map((p) => {
          const { day, month } = dayMonth(p.dueOn);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${day} ${month}, ${formatMoney(p.amount)}`}
              onPress={() => setStep({ to: "paid", payment: p })}
              style={styles.row}
            >
              <View style={styles.texts}>
                <Text style={styles.title} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.line}>{`${day} ${month}`}</Text>
              </View>
              <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
            </Pressable>
          );
        })}
      </Sheet>
    );
  }

  const first = upcoming[0];
  const actions: { title: string; line: string; icon: IconName; tint: string; onPress: () => void }[] = [
    { title: "Трата", line: "наличными · тратит лимит", icon: "arrowDown", tint: color.fg.muted, onPress: () => setStep({ to: "cash", mode: "spend" }) },
    { title: "Получил", line: "доход или вернули долг", icon: "arrowUp", tint: color.accent.signal, onPress: () => setStep({ to: "cash", mode: "received" }) },
    ...(first
      ? [
          {
            title: "Оплатил платёж",
            line: nearest(first),
            icon: "check" as const,
            tint: color.fg.muted,
            onPress: () => setStep(upcoming.length === 1 ? { to: "paid", payment: first } : { to: "payments" }),
          },
        ]
      : []),
    {
      title: "Перевёл между своими",
      line: "отдал в свои или обменял USDC · лимит не меняется",
      icon: "transfer",
      tint: color.fg.muted,
      onPress: () => setStep({ to: "cash", mode: "transfer" }),
    },
  ];

  return (
    <Sheet title="Добавить" onClose={onClose}>
      <View>
        {actions.map((a, i) => (
          <Pressable
            key={a.title}
            accessibilityRole="button"
            accessibilityLabel={a.title}
            accessibilityHint={a.line}
            onPress={a.onPress}
            style={[styles.row, i > 0 && styles.divided]}
          >
            <View style={styles.badge}>
              <Icon name={a.icon} color={a.tint} size={18} />
            </View>
            <View style={styles.texts}>
              <Text style={styles.title}>{a.title}</Text>
              <Text style={styles.line}>{a.line}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.data.grid },
  badge: { width: touchMin - space.md, height: touchMin - space.md, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: color.surface.raised },
  texts: { flex: 1, gap: space.xs / 2 },
  title: { ...type.label, color: color.fg.default },
  line: { ...type.caption, color: color.fg.muted },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  arrow: { ...type.title, color: color.fg.subtle },
});
