import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

/** «3 дек». */
const day = (iso: string) => {
  const { day: d, month } = dayMonth(iso);
  return `${d} ${month}`;
};

/**
 * The sand first line of «До дохода» on «Сегодня» (tasks А24, ЯМ1). The income's day stands in the card's header, so
 * only the day the money lasts to; a run-out day of today is said as «только на сегодня».
 */
export const paceLineText = (p: PaceDto, today: string): string =>
  p.runOutOn <= today ? "В таком темпе денег хватит только на сегодня." : `В таком темпе хватит до ${day(p.runOutOn)}.`;

/** The sheet's first sentence: what happens at the usual day. */
export const paceSheetText = (p: PaceDto, today: string): string =>
  p.runOutOn <= today
    ? `Последние 7 дней уходило около ${formatMoney(p.avgDaily)} в день. В таком темпе денег хватит только на сегодня, а доход — ${day(p.incomeOn)}.`
    : `Последние 7 дней уходило около ${formatMoney(p.avgDaily)} в день. В таком темпе денег хватит до ${day(p.runOutOn)}, а доход — ${day(p.incomeOn)}.`;

/** A whole ₴100, rounded down. */
const HUNDRED = 10_000;

/**
 * The calm middle step of the pace sheet. Its second sentence names the smaller of what lasts until the income and the
 * day's own limit, rounded down to ₴100: still true, and never an invitation to spend above the limit (lead's
 * decision). With nothing left to name only the first sentence stays.
 */
export function paceHintText(hint: NonNullable<PaceDto["hint"]>, dailyLimit: number): string {
  // A server from before А24а2 sends no `untilIncome`: then only the first sentence.
  const toIncome = typeof hint.untilIncome === "number" ? Math.min(hint.untilIncome, Math.floor(dailyLimit / HUNDRED) * HUNDRED) : 0;
  if (!(toIncome > 0)) return `Если тратить около ${formatMoney(hint.daily)} в день — хватит до ${day(hint.lastsUntil)}.`;
  return `Если тратить около ${formatMoney(hint.daily)} в день — хватит до ${day(hint.lastsUntil)}. Около ${formatMoney(toIncome)} — до самого дохода.`;
}

type Props = {
  pace: PaceDto;
  dailyLimit: number;
  /** What is left on the income's day at the limit (`runway.reserve`); null from a server without the runway. */
  reserve: number | null;
  today: string;
  onClose: () => void;
};

/**
 * «Темп трат» (tasks А24, ЯМ1): two sentences instead of a table — what happens at the usual day, and what holding the
 * limit gives. When the limit does not reach the income either (or the reserve is unknown) there is no «останется»:
 * the server's calm middle step stands in its place, if it sent one.
 */
export function PaceSheet({ pace, dailyLimit, reserve, today, onClose }: Props) {
  const lasts = reserve !== null && reserve > 0 && dailyLimit > 0;
  return (
    <Sheet title="Темп трат" onClose={onClose}>
      <View style={styles.body}>
        <Text style={styles.text}>{paceSheetText(pace, today)}</Text>
        {lasts ? (
          <Text style={styles.text}>{`Если держаться лимита ${formatMoney(dailyLimit)} в день, хватит до дохода и останется ${formatMoney(reserve)}.`}</Text>
        ) : (
          pace.hint && <Text style={styles.text}>{paceHintText(pace.hint, dailyLimit)}</Text>
        )}
        <Text style={styles.note}>Лимит от этого не меняется.</Text>
      </View>
      <PrimaryButton label="Понятно" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg, paddingBottom: space.sm },
  text: { ...type.body, color: color.fg.default },
  note: { ...type.caption, color: color.fg.muted },
});
