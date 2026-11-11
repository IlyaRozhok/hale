import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { tokens } from "@hale/tokens";
import type { RunwayDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";
import { nearestDay, runwayChart } from "../runwayChart";
import { RunwayLine } from "./RunwayLine";

const { color, radius, space, touchMin, type } = tokens;

const HEIGHT = 112;
const PAD = 10;
const EDGE = 6;
/** Wider than this from the left, a note or a label turns to the other side so it stays inside. */
const NOTE = 150;

const dateOf = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return `${day} ${month}`;
};

/**
 * The reserve to the next income: one figure and the money day by day under it. The picture carries
 * no dates but its two ends; a touch tells a day's date, money and payment, and with `onPay` the
 * payment there can be pressed to mark it paid.
 */
export function Runway({ runway, today, onPay }: { runway: RunwayDto; today: string; onPay?: (paymentId: string) => void }) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const touched = useRef<number | null>(null);
  const chart = useMemo(() => runwayChart(runway.points, runway.events, Math.max(0, width - EDGE * 2), HEIGHT, PAD), [runway.points, runway.events, width]);

  const title = runway.incomeOn ? "Запас к доходу" : "Запас на 30 дней";
  const short = runway.reserve < 0;
  const drawable = runway.points.length > 1;
  const label =
    `${title} ${formatMoney(runway.reserve)}.` +
    (runway.zeroOn ? ` Деньги до нуля ${dateOf(runway.zeroOn)}.` : "") +
    (runway.events.length > 0 ? ` Платежи: ${runway.events.map((e) => `${e.name} ${dateOf(e.date)}, ${formatMoney(e.amount)}`).join("; ")}.` : "");

  const dayAt = (e: GestureResponderEvent) => (chart.xs.length > 0 ? nearestDay(chart.xs, e.nativeEvent.locationX - EDGE) : null);
  const onGrant = (e: GestureResponderEvent) => {
    const day = dayAt(e);
    touched.current = day;
    setSelected((now) => (now === day ? null : day));
  };
  const onMove = (e: GestureResponderEvent) => {
    const day = dayAt(e);
    if (day === touched.current) return;
    touched.current = day;
    setSelected(day);
  };

  const point = selected === null ? undefined : runway.points[selected];
  const noteX = selected === null ? 0 : EDGE + (chart.xs[selected] ?? 0);
  const crossX = chart.cross === null ? null : EDGE + chart.cross;
  return (
    <View style={styles.root}>
      <View style={styles.head} accessible accessibilityLabel={label}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.figure, short && styles.short]}>{formatMoney(runway.reserve)}</Text>
      </View>
      {drawable && (
        <>
          <View
            testID="runway-chart"
            style={styles.chart}
            onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
            onStartShouldSetResponder={() => true}
            onResponderGrant={onGrant}
            onResponderMove={onMove}
          >
            {width > 0 && <RunwayLine chart={chart} width={width} height={HEIGHT} edge={EDGE} selected={selected} />}
            {crossX !== null && runway.zeroOn && (
              <Text
                style={[styles.cross, crossX > width - NOTE ? { right: width - crossX + space.sm, top: chart.zeroY + 2 } : { left: crossX + space.sm, top: chart.zeroY - 18 }]}
                pointerEvents="none"
              >
                {`ноль ${dateOf(runway.zeroOn)}`}
              </Text>
            )}
            {point && (
              <View style={[styles.note, noteX > width / 2 ? { right: width - noteX + space.sm } : { left: noteX + space.sm }]} pointerEvents={onPay ? "box-none" : "none"}>
                <Text style={styles.noteHead}>{`${point.date === today ? "Сегодня" : dateOf(point.date)} · ${formatMoney(point.balance)}`}</Text>
                {runway.events
                  .filter((e) => e.date === point.date)
                  .map((e) =>
                    onPay ? (
                      <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.name}, ${formatMoney(e.amount)}: отметить оплату`} onPress={() => onPay(e.id)} style={styles.pay}>
                        <Text style={styles.payText}>{`${e.name} ${formatMoney(-e.amount)}`}</Text>
                        <Text style={styles.noteLine}>отметить оплату</Text>
                      </Pressable>
                    ) : (
                      <Text key={e.id} style={styles.noteLine}>{`${e.name} ${formatMoney(-e.amount)}`}</Text>
                    ),
                  )}
                {runway.incomeOn === point.date && <Text style={styles.noteLine}>день дохода</Text>}
              </View>
            )}
          </View>
          <View style={styles.axis}>
            <Text style={styles.tick}>сегодня</Text>
            <Text style={styles.tick}>{runway.incomeOn ? `доход ${dateOf(runway.endOn)}` : dateOf(runway.endOn)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm, paddingHorizontal: space.xs },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  title: { ...type.label, color: color.fg.muted },
  figure: { ...type.title, color: color.fg.default, fontVariant: ["tabular-nums"] },
  short: { color: color.limit.low },
  chart: { height: HEIGHT },
  axis: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: EDGE },
  tick: { ...type.caption, color: color.fg.subtle },
  cross: { ...type.caption, position: "absolute", color: color.limit.low },
  note: {
    position: "absolute",
    top: 0,
    maxWidth: NOTE + space.xl,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  noteHead: { ...type.caption, fontWeight: "500", color: color.fg.default, fontVariant: ["tabular-nums"] },
  noteLine: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  pay: { minHeight: touchMin, justifyContent: "center" },
  payText: { ...type.caption, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
