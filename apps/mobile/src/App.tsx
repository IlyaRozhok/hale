import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { StatusBar } from "expo-status-bar";
import { tokens } from "@tablo/tokens";
import { LimitVisual, type LimitMode } from "./metal";

const { color, space, radius, type, touchMin } = tokens;
const MODES: { id: LimitMode; label: string }[] = [
  { id: "mercury", label: "Ртуть" },
  { id: "ring", label: "Кольцо" },
];

/** Demo screen for the metal prototype: level slider and mode toggle. */
export default function App() {
  const [mode, setMode] = useState<LimitMode>("mercury");
  const [level, setLevel] = useState(0.72);
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.visual}>
        <LimitVisual mode={mode} level={level} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.value}>{Math.round(level * 100)}%</Text>
        <Slider
          minimumValue={0}
          maximumValue={1}
          value={level}
          onValueChange={setLevel}
          minimumTrackTintColor={color.fg.default}
          maximumTrackTintColor={color.data.track}
          thumbTintColor={color.fg.default}
          accessibilityLabel="Уровень"
        />
        <View style={styles.toggle}>
          {MODES.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m.id }}
              onPress={() => setMode(m.id)}
              style={[styles.seg, mode === m.id && styles.segOn]}
            >
              <Text style={[styles.segText, mode === m.id && styles.segTextOn]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base, paddingTop: 64 },
  visual: { flex: 1, margin: space.lg },
  panel: { padding: space.xl, gap: space.lg, backgroundColor: color.surface.inset },
  value: { ...type.display, color: color.fg.default },
  toggle: { flexDirection: "row", gap: space.sm },
  seg: {
    flex: 1,
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: color.surface.raised,
  },
  segOn: { backgroundColor: color.accent.default },
  segText: { ...type.label, color: color.fg.muted },
  segTextOn: { color: color.accent.fgOnAccent },
});
