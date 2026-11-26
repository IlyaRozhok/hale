import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { RunwayDto, TodayDto } from "@hale/contracts";
import { ENTRANCE } from "../../entrance";
import { dayMonth, formatMoney } from "../../format";
import { paymentsSection, type PaymentRow } from "../../paymentsSection";
import { Appear } from "../Entrance";
import { Icon } from "../Icon";
import { SECTION_MARGIN, SectionHead } from "./SectionHead";

const { color, space, touchMin, type } = tokens;

/**
 * The «Платежи» section of «Сегодня» (task ЧЛ6): up to three nearest unpaid payments before the income. Not a card:
 * it stands on the screen itself under its own header, like «До дохода».
 *
 * Contract:
 * - `paymentsSection` decides everything that is said: which payments (the runway's, so no taxes), their order, the
 *   header's count and sum, the due words. Without a runway, an income date or payments nothing is drawn.
 * - A row is a button that calls `onPay` with the payment's id when `upcoming` lists the payment and `onPay` is
 *   given; otherwise it is plain text.
 * - With more than three payments the last row is «Ещё N · ₴сумма»; with `onOpenPlan` it is a button that calls it.
 * - The due words are sand for today, tomorrow and a payment that waits; nothing here is red.
 * - `entrance` is the screen's entrance key (task ЧЛ8; 0 or absent — no motion): with a new one the rows fade in one
 *   after another, «Ещё N» last. They are buttons, with their names for VoiceOver, from the first frame.
 */
export function PaymentsSection({
  runway,
  upcoming,
  today,
  onPay,
  onOpenPlan,
  entrance = 0,
}: {
  runway: RunwayDto | null | undefined;
  upcoming: TodayDto["upcoming"];
  /** The Kyiv day the data is for, ISO. */
  today: string;
  onPay?: (id: string) => void;
  onOpenPlan?: () => void;
  entrance?: number;
}) {
  const section = paymentsSection(runway, upcoming, today);
  if (!section) return null;
  const appear = (i: number) => ({ play: entrance, ms: ENTRANCE.rowMs, delay: i * ENTRANCE.rowStepMs });
  return (
    <View testID="payments-section" style={styles.section}>
      <View accessible accessibilityRole="header" accessibilityLabel={`Платежи, ${section.caption}`}>
        <SectionHead title="Платежи" caption={section.caption} />
      </View>
      <View>
        {section.rows.map((row, i) => (
          <Appear key={row.id} testID={`payment-appear-${row.id}`} {...appear(i)}>
            <Row row={row} divided={i > 0} onPay={row.payable ? onPay : undefined} />
          </Appear>
        ))}
        {section.more && (
          <Appear testID="payment-appear-more" {...appear(section.rows.length)}>
            {onOpenPlan ? (
              <Pressable accessibilityRole="button" accessibilityLabel={section.more.text} accessibilityHint="Открывает план" onPress={onOpenPlan} style={[styles.row, styles.divided]}>
                <Text style={styles.more}>{section.more.text}</Text>
                <Icon name="chevron" color={color.list.chevron} size={14} />
              </Pressable>
            ) : (
              <View style={[styles.row, styles.divided]}>
                <Text style={styles.more}>{section.more.text}</Text>
              </View>
            )}
          </Appear>
        )}
      </View>
    </View>
  );
}

function Row({ row, divided, onPay }: { row: PaymentRow; divided: boolean; onPay?: (id: string) => void }) {
  const { day, month } = dayMonth(row.dueOn);
  const amount = formatMoney(row.amount);
  const label = `${row.name}, ${row.due}, ${amount}`;
  const body = (
    <>
      <View style={styles.date}>
        <Text style={styles.day}>{day}</Text>
        <Text style={styles.month}>{month}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={[styles.due, row.soon && styles.soon]}>{row.due}</Text>
      </View>
      {/* The amount never gives way and is never cut: only the name shrinks. */}
      <Text style={styles.amount}>{amount}</Text>
    </>
  );
  const style = [styles.row, divided && styles.divided];
  return onPay ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: отметить оплату`} onPress={() => onPay(row.id)} style={style}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} style={style}>
      {body}
    </View>
  );
}

/** Wide enough for two digits at 17 pt; at a larger system text size it grows rather than cuts the day. */
const DATE_WIDTH = 30;

const styles = StyleSheet.create({
  section: { marginTop: SECTION_MARGIN, gap: space.xs },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  date: { minWidth: DATE_WIDTH, alignItems: "center" },
  day: { ...type.label, fontSize: 17, lineHeight: 20, color: color.fg.default, fontVariant: ["tabular-nums"] },
  month: { ...type.caption, fontSize: 11, lineHeight: 14, color: color.fg.subtle },
  text: { flex: 1 },
  name: { ...type.label, fontWeight: "400", color: color.fg.default },
  due: { ...type.caption, color: color.fg.subtle },
  soon: { color: color.limit.low },
  amount: { ...type.label, fontSize: 15, fontWeight: "400", color: color.fg.default, fontVariant: ["tabular-nums"], flexShrink: 0 },
  more: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"], flex: 1 },
});
