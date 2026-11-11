import { useMemo } from "react";
import { Canvas, Circle, DashPathEffect, Group, Line, LinearGradient, Path, Skia, rect, vec } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";
import type { RunwayChart } from "../runwayChart";

const { color } = tokens;

type Props = {
  chart: RunwayChart;
  width: number;
  height: number;
  /** Room left and right of the first and last day, so their dots are not cut. */
  edge: number;
  /** The touched day, or null. */
  selected: number | null;
};

/**
 * The runway's line: a dashed forecast with a soft fill down to the zero line, a straight step where
 * a payment leaves, a solid dot on today and a ring on the last day. What is below zero is sand.
 */
export function RunwayLine({ chart, width, height, edge, selected }: Props) {
  const { line, zeroY, xs, ys } = chart;
  const paths = useMemo(() => {
    if (line.length < 2) return null;
    const draw = () => {
      const b = Skia.PathBuilder.Make();
      line.forEach((p, i) => (i === 0 ? b.moveTo(p.x, p.y) : b.lineTo(p.x, p.y)));
      return b;
    };
    const stroke = draw().build();
    const area = draw().lineTo(line[line.length - 1]!.x, zeroY).lineTo(line[0]!.x, zeroY).close().build();
    return { stroke, area };
  }, [line, zeroY]);
  if (!paths) return null;

  const inner = width - edge * 2;
  const first = line[0]!;
  const last = line[line.length - 1]!;
  // A step is two points on one day: the dot sits where the payment lands.
  const steps = line.filter((p, i) => i > 0 && line[i - 1]!.x === p.x);
  const tone = (y: number) => (y > zeroY ? color.runway.low : color.runway.line);
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Group transform={[{ translateX: edge }]}>
        <Group clip={rect(-edge, 0, width, zeroY)}>
          <Path path={paths.area}>
            <LinearGradient start={vec(0, 0)} end={vec(0, zeroY)} colors={[color.runway.fill, color.runway.fade]} />
          </Path>
          <Path path={paths.stroke} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" color={color.runway.line}>
            <DashPathEffect intervals={[5, 4]} />
          </Path>
        </Group>
        <Group clip={rect(-edge, zeroY, width, height - zeroY)}>
          <Path path={paths.area}>
            <LinearGradient start={vec(0, zeroY)} end={vec(0, height)} colors={[color.runway.lowFade, color.runway.lowFill]} />
          </Path>
          <Path path={paths.stroke} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" color={color.runway.low}>
            <DashPathEffect intervals={[5, 4]} />
          </Path>
        </Group>
        <Line p1={vec(0, zeroY)} p2={vec(inner, zeroY)} color={color.runway.zero} strokeWidth={1} />
        {steps.map((p) => (
          <Circle key={p.x} cx={p.x} cy={p.y} r={2.5} color={tone(p.y)} />
        ))}
        <Circle cx={first.x} cy={first.y} r={3.5} color={tone(first.y)} />
        <Circle cx={last.x} cy={last.y} r={3.5} color={color.surface.base} />
        <Circle cx={last.x} cy={last.y} r={3.5} style="stroke" strokeWidth={1.5} color={tone(last.y)} />
        {selected !== null && xs[selected] !== undefined && (
          <>
            <Line p1={vec(xs[selected]!, 0)} p2={vec(xs[selected]!, height)} color={color.runway.zero} strokeWidth={1} />
            <Circle cx={xs[selected]!} cy={ys[selected]!} r={4.5} color={tone(ys[selected]!)} />
          </>
        )}
      </Group>
    </Canvas>
  );
}
