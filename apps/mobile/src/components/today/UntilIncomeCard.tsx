import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { PaceDto, RunwayDto } from "@hale/contracts";
import { daysText, daysToIncomeLabel, formatMoney } from "../../format";
import { paceLineText } from "../PaceSheet";
import { Runway } from "../Runway";
import { SECTION_MARGIN, SectionHead } from "./SectionHead";

const { color, space, touchMin, type } = tokens;

/**
 * The «До дохода» section of «Сегодня»: one thing said first, then the runway chart. Since ЧЛ5 it is not a card: it
 * stands on the screen itself under its own header (the file keeps its name from ЧЛ1).
 *
 * Contract (tasks ЯМ1, ЧЛ5):
 * - The header is «До дохода» and, at the right, the count of days to the income as one phrase («4 дня»). The count
 *   is `daysLeft`, the server's own number the limit is spread over, not a difference of dates; when it is absent
 *   or not positive the header has no count. The income's date is under the chart's axis.
 * - `pace` is the pace the screen decided to show (null on a calm day, and when a note already carries the same news).
 *   With it the top of the card is a button that calls `onOpenPace`: the pace line, then «Если держаться лимита…».
 * - Without it the top is plain text: «К доходу останется ₴X» with the limit under it when something is left at the
 *   limit; otherwise «Запас к доходу ₴X» (sand when it is below zero).
 * - With no income date there is no top at all and `Runway` draws its own head.
 * - `runwayLimit` is the limit the runway is drawn for: on the day the shortage came on it is tomorrow's (А23).
 * - `onPay` gets the id of the payment touched on the chart.
 * - `entrance` is the screen's entrance key (task ЧЛ8), passed on to the chart, whose line draws itself.
 */
export function UntilIncomeCard({
  runway,
  pace,
  runwayLimit,
  daysLeft,
  today,
  onOpenPace,
  onPay,
  entrance = 0,
}: {
  runway: RunwayDto;
  pace: PaceDto | null;
  runwayLimit: number;
  /** `state.daysLeft` of `GET /today`: 1 on the income's day. */
  daysLeft?: number;
  /** The Kyiv day the data is for, ISO. */
  today: string;
  onOpenPace: () => void;
  onPay: (id: string) => void;
  entrance?: number;
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
  const days = daysLeft !== undefined && Number.isInteger(daysLeft) && daysLeft > 0 ? daysLeft : null;
  const headLabel = days !== null ? daysToIncomeLabel(days) : "До дохода.";
  // «До дохода» on the left, the days to the income on the right; with a chevron when the top opens the pace.
  const caption = days !== null ? daysText(days) : null;

  return (
    <View testID="until-income" style={styles.section}>
      {pace ? (
        // A hard day: the top of the card opens «Темп трат»; the chart below keeps its own touch.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[incomeOn ? headLabel : null, paceLine, stepLine].filter(Boolean).join(" ")}
          accessibilityHint="Открывает темп трат"
          onPress={onOpenPace}
          style={styles.untilTop}
        >
          {incomeOn && <SectionHead title="До дохода" caption={caption} chevron />}
          <Text style={styles.paceText}>{paceLine}</Text>
          {/* One whole sentence (texts are not assembled from pieces), so the amount is not set in bold as in the mockup. */}
          {stepLine && <Text style={styles.untilUnder}>{stepLine}</Text>}
        </Pressable>
      ) : (
        incomeOn && (
          <View
            accessible
            accessibilityLabel={[headLabel, calmLine && calmUnder ? `${calmLine}, ${calmUnder}.` : `${reserveLine}.`].join(" ")}
            style={styles.untilTop}
          >
            <SectionHead title="До дохода" caption={caption} />
            {calmLine && <Text style={styles.calmText}>{calmLine}</Text>}
            {calmUnder && <Text style={styles.untilUnder}>{calmUnder}</Text>}
            {reserveLine && <Text style={[styles.calmText, runway.reserve < 0 && styles.reserveShort]}>{reserveLine}</Text>}
          </View>
        )
      )}
      <Runway runway={runway} today={today} showHead={incomeOn === null} onPay={onPay} entrance={entrance} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: SECTION_MARGIN, gap: space.md },
  untilTop: { minHeight: touchMin, gap: space.xs },
  paceText: { ...type.title, fontSize: 18, color: color.limit.low },
  calmText: { ...type.title, fontSize: 18, color: color.fg.default, fontVariant: ["tabular-nums"] },
  untilUnder: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  reserveShort: { color: color.limit.low },
});
