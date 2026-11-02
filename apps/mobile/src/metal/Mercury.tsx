import type { SharedValue } from "react-native-reanimated";
import { HalfResCanvas, MetalFill } from "./HalfResCanvas";

type Props = { width: number; height: number; time: SharedValue<number>; level: SharedValue<number> };

/** Variant A: a pool of metal whose waterline sits at `level` of the height. */
export function Mercury({ width, height, time, level }: Props) {
  return (
    <HalfResCanvas width={width} height={height}>
      {(s) => <MetalFill width={s.width} height={s.height} time={time} level={level} pool />}
    </HalfResCanvas>
  );
}
