import { useMemo } from "react";
import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";

// Tabler outline icons, 24x24, drawn with strokes.
const PATHS = {
  home: "M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6",
  list: "M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01",
  chart: "M3 13a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM15 9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM4 20h14",
  target: "M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
  user: "M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-6-6",
  close: "M18 6L6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  bell: "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6M9 17v1a3 3 0 0 0 6 0v-1",
  cart: "M4 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 17h-11v-14h-2M6 5l14 1l-1 7h-13",
  coffee:
    "M3 14c.83.642 2.077 1.017 3.5 1c1.423.017 2.67-.358 3.5-1c.83-.642 2.077-1.017 3.5-1c1.423-.017 2.67.358 3.5 1M8 3a2.4 2.4 0 0 0-1 2a2.4 2.4 0 0 0 1 2M12 3a2.4 2.4 0 0 0-1 2a2.4 2.4 0 0 0 1 2M3 10h14v5a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-5zM16.746 16.726a3 3 0 1 0 .252-5.555",
  car: "M5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 17h-2v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6-6h15m-6 0v-5",
  heart: "M19.5 12.572l-7.5 7.428l-7.5-7.428a5 5 0 1 1 7.5-6.566a5 5 0 1 1 7.5 6.572",
  bolt: "M13 3v7h6l-8 11v-7h-6l8-11",
  phone: "M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5-2.5l5 2v4a2 2 0 0 1-2 2a16 16 0 0 1-15-15a2 2 0 0 1 2-2",
  bag: "M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1-2.966 2.544h-6.852a3 3 0 0 1-2.965-2.544l-1.255-8.152a2 2 0 0 1 1.977-2.304zM9 11v-5a3 3 0 0 1 6 0v5",
  ticket: "M15 5v2M15 11v2M15 17v2M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4v-3a2 2 0 0 1 2-2",
  repeat: "M4 12v-3a3 3 0 0 1 3-3h13m-3-3l3 3l-3 3M20 12v3a3 3 0 0 1-3 3h-13m3 3l-3-3l3-3",
  receipt: "M5 21v-16a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2l-2 2l-2-2l-2 2l-2-2l-3 2M9 7h6M9 11h6M13 15h2",
  cash: "M7 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2zM12 14a2 2 0 1 0 4 0a2 2 0 0 0-4 0M17 9v-2a2 2 0 0 0-2-2h-10a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",
  transfer: "M21 7h-18M18 10l3-3l-3-3M6 20l-3-3l3-3M3 17h18",
  arrowIn: "M17 7l-10 10M16 17h-9v-9",
  circle: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
  route: "M3 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0M19 7a2 2 0 1 0 0-4a2 2 0 0 0 0 4M11 19h5.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7h4.5",
  chevron: "M9 6l6 6l-6 6",
  filter: "M14 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 6h10M18 6h2M6 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 12h2M10 12h10M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 18h11M19 18h1",
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
