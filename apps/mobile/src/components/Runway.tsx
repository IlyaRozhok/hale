import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { tokens } from "@hale/tokens";
import type { RunwayDto } from "@hale/contracts";
import { dayMonth, formatMoney } from "../format";
import { nearestDay, runwayChart } from "../runwayChart";
import { runwayGesture, type RunwayGesture } from "../runwayGesture";
import { Icon } from "./Icon";
import { RunwayLine } from "./RunwayLine";

const { color, space, touchMin, type } = tokens;

const HEIGHT = 112;
const PAD = 10;
const EDGE = 6;
/** Closer than this to the right edge, the zero label turns to the left so it stays inside. */
const LABEL = 96;

const dateOf = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return `${day} ${month}`;
};

/**
 * The reserve to the next income: one figure and the money day by day under it. The picture carries
 * no dates but its two ends; a touch tells a day's date, money and payment, and with `onPay` the
 * payment there can be pressed to mark it paid. While no day is touched, the same place under the
 * graph names the nearest payment of the stretch, if there is one.
 */
export function Runway({ runway, today, onPay }: { runway: RunwayDto; today: string; onPay?: (paymentId: string) => void }) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const touched = useRef<number | null>(null);
  const gesture = useRef<{ x: number; y: number; before: number | null; kind: RunwayGesture } | null>(null);
  const chart = useMemo(() => runwayChart(runway.points, runway.events, Math.max(0, width - EDGE * 2), HEIGHT, PAD), [runway.points, runway.events, width]);

  const title = runway.incomeOn ? "Запас к доходу" : "Запас на 30 дней";
  const short = runway.reserve < 0;
  const drawable = runway.points.length > 1;
  const label =
    `${title} ${formatMoney(runway.reserve)}.` +
    (runway.zeroOn ? ` Деньги до нуля ${dateOf(runway.zeroOn)}.` : "") +
    (runway.events.length > 0 ? ` Платежи: ${runway.events.map((e) => `${e.name} ${dateOf(e.date)}, ${formatMoney(e.amount)}`).join("; ")}.` : "");

  const dayAt = (e: GestureResponderEvent) => (chart.xs.length > 0 ? nearestDay(chart.xs, e.nativeEvent.locationX - EDGE) : null);
  // A touch picks its day at once, as a tap. Once it moves past the slop it is read for good: sideways
  // it scrubs the days and holds the touch; otherwise the page takes it to scroll or pull, and the
  // day goes back to what it was before the touch, so a scroll never leaves a day chosen or put away.
  const onGrant = (e: GestureResponderEvent) => {
    const day = dayAt(e);
    touched.current = day;
    gesture.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, before: selected, kind: "wait" };
    setSelected((now) => (now === day ? null : day));
  };
  const toPage = () => {
    const g = gesture.current;
    if (g === null || g.kind === "scrub") return;
    g.kind = "scroll";
    setSelected(g.before);
  };
  const onMove = (e: GestureResponderEvent) => {
    const g = gesture.current;
    if (g === null || g.kind === "scroll") return;
    if (g.kind === "wait") {
      const kind = runwayGesture(e.nativeEvent.pageX - g.x, e.nativeEvent.pageY - g.y);
      if (kind === "wait") return;
      if (kind === "scroll") return toPage();
      g.kind = "scrub";
    }
    const day = dayAt(e);
    if (day === touched.current) return;
    touched.current = day;
    setSelected(day);
  };
  const onTerminate = () => {
    toPage();
    gesture.current = null;
  };

  const point = selected === null ? undefined : runway.points[selected];
  // ISO dates compare as text; of equal dates the first in the server's order stays.
  const next = runway.events.reduce<RunwayDto["events"][number] | undefined>((first, e) => (first === undefined || e.date < first.date ? e : first), undefined);
  const nextDay = next === undefined ? "" : next.date === today ? "сегодня" : dateOf(next.date);
  const nextBody = next && (
    <>
      <View style={styles.nextText}>
        <Text style={styles.nextCaption}>Ближайший платёж</Text>
        <Text style={styles.nextName} numberOfLines={1}>{`${next.name} · ${nextDay}`}</Text>
      </View>
      <Text style={styles.nextAmount}>{formatMoney(next.amount)}</Text>
    </>
  );
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
            onResponderTerminationRequest={() => gesture.current?.kind !== "scrub"}
            onResponderTerminate={onTerminate}
            onResponderRelease={() => {
              gesture.current = null;
            }}
          >
            {width > 0 && <RunwayLine chart={chart} width={width} height={HEIGHT} edge={EDGE} selected={selected} />}
            {crossX !== null && runway.zeroOn && (
              <Text
                style={[styles.cross, crossX > width - LABEL ? { right: width - crossX + space.sm, top: chart.zeroY + 2 } : { left: crossX + space.sm, top: chart.zeroY - 18 }]}
                pointerEvents="none"
              >
                {`ноль ${dateOf(runway.zeroOn)}`}
              </Text>
            )}
          </View>
          <View style={styles.axis}>
            <Text style={styles.tick}>сегодня</Text>
            <Text style={styles.tick}>{runway.incomeOn ? `доход ${dateOf(runway.endOn)}` : dateOf(runway.endOn)}</Text>
          </View>
          {/* Under the graph, so the line is never covered: the touched day, and its payments to press. */}
          {point && (
            <View style={styles.note}>
              <View style={styles.noteRow}>
                <Text style={styles.noteHead}>{`${point.date === today ? "Сегодня" : dateOf(point.date)} · ${formatMoney(point.balance)}`}</Text>
                {runway.incomeOn === point.date && <Text style={styles.noteLine}>день дохода</Text>}
              </View>
              {runway.events
                .filter((e) => e.date === point.date)
                .map((e) =>
                  onPay ? (
                    <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.name}, ${formatMoney(e.amount)}: отметить оплату`} onPress={() => onPay(e.id)} style={[styles.noteRow, styles.pay]}>
                      <Text style={styles.payText}>{`${e.name} ${formatMoney(-e.amount)}`}</Text>
                      <Text style={styles.noteLine}>отметить оплату</Text>
                    </Pressable>
                  ) : (
                    <Text key={e.id} style={styles.noteLine}>{`${e.name} ${formatMoney(-e.amount)}`}</Text>
                  ),
                )}
            </View>
          )}
          {!point &&
            next &&
            (onPay ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ближайший платёж: ${next.name}, ${nextDay}, ${formatMoney(next.amount)}: отметить оплату`}
                onPress={() => onPay(next.id)}
                style={styles.next}
              >
                {nextBody}
                <Icon name="chevron" color={color.fg.subtle} size={16} />
              </Pressable>
            ) : (
              <View style={styles.next}>{nextBody}</View>
            ))}
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
  note: { paddingHorizontal: EDGE, paddingTop: space.xs },
  noteRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  noteHead: { ...type.label, color: color.fg.default, fontVariant: ["tabular-nums"] },
  noteLine: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  pay: { minHeight: touchMin },
  next: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: EDGE, paddingTop: space.xs },
  nextText: { flex: 1 },
  nextCaption: { ...type.caption, color: color.fg.subtle },
  nextName: { ...type.label, color: color.fg.default },
  nextAmount: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"] },
  payText: { ...type.label, fontWeight: "400", color: color.fg.default, fontVariant: ["tabular-nums"], flexShrink: 1 },
});
