import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto, RunwayDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../../format";
import { Icon } from "../Icon";
import { paceLineText } from "../PaceSheet";
import { Runway } from "../Runway";

const { color, radius, space, touchMin, type } = tokens;

/** «15 дек». */
function dayMonthText(iso: string): string {
  const { day, month } = dayMonth(iso);
  return `${day} ${month}`;
}

/**
 * The «До дохода» card of «Сегодня»: one thing said first, then the runway chart.
 *
 * Contract (task ЯМ1):
 * - `pace` is the pace the screen decided to show (null on a calm day, and when a note already carries the same news).
 *   With it the top of the card is a button that calls `onOpenPace`: the pace line, then «Если держаться лимита…».
 * - Without it the top is plain text: «К доходу останется ₴X» with the limit under it when something is left at the
 *   limit; otherwise «Запас к доходу ₴X» (sand when it is below zero).
 * - With no income date there is no top at all and `Runway` draws its own head.
 * - `runwayLimit` is the limit the runway is drawn for: on the day the shortage came on it is tomorrow's (А23).
 * - `onPay` gets the id of the payment touched on the chart.
 */
export function UntilIncomeCard({
  runway,
  pace,
  runwayLimit,
  today,
  onOpenPace,
  onPay,
}: {
  runway: RunwayDto;
  pace: PaceDto | null;
  runwayLimit: number;
  /** The Kyiv day the data is for, ISO. */
  today: string;
  onOpenPace: () => void;
  onPay: (id: string) => void;
}) {
  // «останется» only when something is left at the limit; otherwise, and with no income date, the runway names its
  // reserve as before.
  const incomeOn = runway.incomeOn ?? null;
  const left = incomeOn !== null && runway.reserve > 0 ? runway.reserve : null;
  // «Если держаться лимита» only when there is a limit to hold.
  const step = left !== null && runwayLimit > 0 ? left : null;
  const paceLine = pace ? paceLineText(pace, today) : null;
  const stepLine = pace && step !== null ? `Если держаться лимита — к доходу останется ${formatMoney(step)}.` : null;
  const calmLine = !pace && step !== null ? `К доходу останется ${formatMoney(step)}` : null;
  const calmUnder = calmLine ? `если держаться лимита ${formatMoney(runwayLimit)} в день` : null;
  // A calm day with nothing to promise: the reserve in the words it always had, under the card's own header.
  const reserveLine = !pace && calmLine === null ? `Запас к доходу ${formatMoney(runway.reserve)}` : null;
  const incomeDay = incomeOn ? dayMonthText(incomeOn) : null;

  return (
    <View style={styles.untilCard}>
      {pace ? (
        // A hard day: the top of the card opens «Темп трат»; the chart below keeps its own touch.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[incomeDay ? `До дохода, ${incomeDay}.` : null, paceLine, stepLine].filter(Boolean).join(" ")}
          accessibilityHint="Открывает темп трат"
          onPress={onOpenPace}
          style={styles.untilTop}
        >
          {incomeDay && <UntilHead day={incomeDay} chevron />}
          <Text style={styles.paceText}>{paceLine}</Text>
          {/* One whole sentence (texts are not assembled from pieces), so the amount is not set in bold as in the mockup. */}
          {stepLine && <Text style={styles.untilUnder}>{stepLine}</Text>}
        </Pressable>
      ) : (
        incomeDay && (
          <View
            accessible
            accessibilityLabel={[`До дохода, ${incomeDay}.`, calmLine && calmUnder ? `${calmLine}, ${calmUnder}.` : `${reserveLine}.`].join(" ")}
            style={styles.untilTop}
          >
            <UntilHead day={incomeDay} chevron={false} />
            {calmLine && <Text style={styles.calmText}>{calmLine}</Text>}
            {calmUnder && <Text style={styles.untilUnder}>{calmUnder}</Text>}
            {reserveLine && <Text style={[styles.calmText, runway.reserve < 0 && styles.reserveShort]}>{reserveLine}</Text>}
          </View>
        )
      )}
      <Runway runway={runway} today={today} showHead={incomeDay === null} onPay={onPay} />
    </View>
  );
}

/** «До дохода» on the left, the income's day on the right; with a chevron when the top of the card opens the pace. */
function UntilHead({ day, chevron }: { day: string; chevron: boolean }) {
  return (
    <View style={styles.untilHead}>
      <Text style={styles.untilTitle}>До дохода</Text>
      <View style={styles.untilDate}>
        <Text style={styles.untilTitle}>{day}</Text>
        {chevron && <Icon name="chevron" color={color.list.chevron} size={14} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  untilCard: { borderRadius: radius.card, backgroundColor: color.card.fill, paddingHorizontal: space.md, paddingVertical: space.lg, gap: space.md },
  untilTop: { minHeight: touchMin, gap: space.xs, paddingHorizontal: space.xs },
  untilHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  untilDate: { flexDirection: "row", alignItems: "center", gap: 2 },
  untilTitle: { ...type.label, fontWeight: "400", color: color.list.secondary, fontVariant: ["tabular-nums"] },
  paceText: { ...type.title, fontSize: 18, color: color.limit.low },
  calmText: { ...type.title, fontSize: 18, color: color.fg.default, fontVariant: ["tabular-nums"] },
  untilUnder: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  reserveShort: { color: color.limit.low },
});
