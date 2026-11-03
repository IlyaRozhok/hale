import { StyleSheet } from "react-native";
import { Canvas, Group, RoundedRect, Shader } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";
import type { DayEdge } from "../calendarLayout";
import { STILL_TIME } from "./level";
import { metalEffect } from "./metal.sksl";

const { edge, edgeToday } = tokens.metal;

type Props = { edges: readonly DayEdge[]; width: number; height: number; radius: number };

/** Thin edges cut from one still sheet of the metal: one canvas, drawn once, however many days there are. */
export function MetalEdges({ edges, width, height, radius }: Props) {
  const uniforms = { r: [width, height], t: STILL_TIME, level: 1, pool: 0 };
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {edges.map((e) => {
        const shape = { x: e.x, y: e.y, width: e.width, height: e.height, r: radius, style: "stroke" as const, strokeWidth: e.today ? edgeToday : edge };
        return (
          <Group key={e.date}>
            {/* Silver beneath: the metal's dark bands would otherwise break the line into dashes. */}
            <RoundedRect {...shape} color={tokens.color.backdrop.peak} />
            <RoundedRect {...shape} opacity={0.8}>
              <Shader source={metalEffect} uniforms={uniforms} />
            </RoundedRect>
          </Group>
        );
      })}
    </Canvas>
  );
}
