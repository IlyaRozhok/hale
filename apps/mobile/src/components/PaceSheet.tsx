import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

/** «3 дек». */
const day = (iso: string) => {
  const { day: d, month } = dayMonth(iso);
  return `${d} ${month}`;
};

/** The sand line under the limit on «Сегодня» (task А24). */
export const paceLineText = (p: PaceDto): string => `В таком темпе хватит до ${day(p.runOutOn)} — доход ${day(p.incomeOn)}`;

/** A whole ₴100, rounded down. */
const HUNDRED = 10_000;

/**
 * The calm step of the pace sheet. Its second sentence names the smaller of what lasts until the income and the
 * day's own limit, rounded down to ₴100: still true, and never an invitation to spend above the limit (lead's
 * decision). With nothing left to name only the first sentence stays.
 */
export function paceHintText(hint: NonNullable<PaceDto["hint"]>, dailyLimit: number): string {
  const toIncome = Math.min(hint.untilIncome, Math.floor(dailyLimit / HUNDRED) * HUNDRED);
  if (toIncome <= 0) return `Если тратить около ${formatMoney(hint.daily)} в день — хватит до ${day(hint.lastsUntil)}.`;
  return `Если тратить около ${formatMoney(hint.daily)} в день — хватит до ${day(hint.lastsUntil)}. Около ${formatMoney(toIncome)} — до самого дохода.`;
}

type Props = { pace: PaceDto; dailyLimit: number; onClose: () => void };

/** «Темп трат» (task А24, variant А): the usual day against the limit and where each leads, with no judgement. */
export function PaceSheet({ pace, dailyLimit, onClose }: Props) {
  return (
    <Sheet title="Темп трат" onClose={onClose}>
      <View style={styles.card}>
        <Row name="Обычно в день" value={formatMoney(pace.avgDaily)} first />
        <Row name="Лимит" value={formatMoney(dailyLimit)} />
        <Row name="Хватит до" value={day(pace.runOutOn)} warning />
        <Row name="Доход" value={day(pace.incomeOn)} />
      </View>
      <View style={[styles.card, styles.hintCard]}>
        {pace.hint && <Text style={styles.hint}>{paceHintText(pace.hint, dailyLimit)}</Text>}
        <Text style={styles.note}>Обычный день — среднее за последние 7 дней. Лимит от этого не меняется.</Text>
      </View>
      <PrimaryButton label="Понятно" onPress={onClose} />
    </Sheet>
  );
}

function Row({ name, value, first = false, warning = false }: { name: string; value: string; first?: boolean; warning?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${name}: ${value}`} style={[styles.row, !first && styles.divided]}>
      <Text style={styles.name}>{name}</Text>
      <Text style={[styles.value, warning && styles.warning]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  hintCard: { paddingVertical: space.lg, gap: space.sm },
  row: { minHeight: touchMin, paddingVertical: space.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  value: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  warning: { color: color.limit.low },
  hint: { ...type.body, color: color.fg.default },
  note: { ...type.caption, color: color.fg.muted },
});
