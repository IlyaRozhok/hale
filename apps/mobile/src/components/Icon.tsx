import { useMemo } from "react";
import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";

// Tabler outline icons, 24x24, drawn with strokes.
const PATHS = {
  home: "M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6",
  list: "M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01",
  target: "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
  user: "M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-6-6",
  close: "M18 6L6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof PATHS;

type Props = { name: IconName; color: string; size?: number };

/** A decorative icon; the pressable around it carries the accessibility label. */
export function Icon({ name, color, size = 24 }: Props) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(PATHS[name]), [name]);
  if (!path) return null;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: size / 24 }]}>
        <Path path={path} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" color={color} />
      </Group>
    </Canvas>
  );
}
