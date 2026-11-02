import { Group, Mask, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";
import type { SharedValue } from "react-native-reanimated";
import { tokens } from "@tablo/tokens";
import { HalfResCanvas, MetalFill } from "./HalfResCanvas";

type Props = { size: number; time: SharedValue<number>; level: SharedValue<number> };

// Proportions of mockup C: 248 box, radius 108, stroke 20.
const RADIUS = 108 / 248;
const STROKE = 20 / 248;

/** Variant C: a metal ring over a dark track; the metal arc shrinks as the level drops. */
export function Ring({ size, time, level }: Props) {
  return (
    <HalfResCanvas width={size} height={size}>
      {(s) => <RingLayers size={s.width} time={time} level={level} />}
    </HalfResCanvas>
  );
}

function RingLayers({ size, time, level }: Props) {
  const c = size / 2;
  const circle = useMemo(() => Skia.PathBuilder.Make().addCircle(c, c, RADIUS * size).build(), [c, size]);
  const stroke = STROKE * size;
  // Start at 12 o'clock, clockwise.
  const rotate = [{ rotate: -Math.PI / 2 }];
  return (
    <>
      <Group origin={{ x: c, y: c }} transform={rotate}>
        <Path path={circle} style="stroke" strokeWidth={stroke} color={tokens.color.data.track} />
      </Group>
      <Mask
        mask={
          <Group origin={{ x: c, y: c }} transform={rotate}>
            <Path
              path={circle}
              style="stroke"
              strokeWidth={stroke}
              strokeCap="round"
              color={tokens.color.fg.default}
              start={0}
              end={level}
            />
          </Group>
        }
      >
        <MetalFill width={size} height={size} time={time} level={level} pool={false} />
      </Mask>
    </>
  );
}
