import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";

const { color, radius, space, type } = tokens;

type Props<K extends string> = {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
};

/**
 * A segmented control in the iOS manner, drawn from the tokens (no native dependency): a graphite track, the chosen
 * segment a lighter fill with white text, the rest muted. No colour accent: the choice is shown by lightness.
 */
export function Segmented<K extends string>({ options, value, onChange }: Props<K>) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.key)}
            hitSlop={HIT}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The iOS control's height; the hit area reaches the touch minimum above and below.
const SEGMENT = 32;
const HIT = { top: (tokens.touchMin - SEGMENT) / 2, bottom: (tokens.touchMin - SEGMENT) / 2 };

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: 2, borderRadius: radius.md, backgroundColor: color.card.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: color.card.edge },
  segment: { flex: 1, minHeight: SEGMENT, alignItems: "center", justifyContent: "center", borderRadius: radius.md - 2, paddingHorizontal: space.sm },
  selected: { backgroundColor: color.surface.overlay },
  label: { ...type.label, color: color.fg.muted },
  labelSelected: { color: color.fg.default },
});
