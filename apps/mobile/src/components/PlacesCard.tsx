import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney, pluralIndex } from "../format";

const { color, radius, space, touchMin, type } = tokens;

type Place = NonNullable<InsightsMonthDto["places"]>[number];

/** «1 раз», «2 раза», «5 раз», «22 раза». */
export const visitsText = (n: number): string => `${n} ${["раз", "раза", "раз"][pluralIndex(n)]}`;

/**
 * «Места» on «Итоги» (task В3, variant А): the month's largest places by sum, as the server sends them, up to five.
 * The rows lead nowhere yet: «Операции» has no filter by place. Nothing is drawn when there are no places.
 */
export function PlacesCard({ places }: { places: Place[] | undefined }) {
  if (!places || places.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>Места</Text>
      <View testID="places-card" style={styles.card}>
        {places.map((p, i) => (
          <PlaceRow key={p.key} p={p} first={i === 0} />
        ))}
      </View>
    </View>
  );
}

function PlaceRow({ p, first }: { p: Place; first: boolean }) {
  const visits = visitsText(p.visits);
  const amount = formatMoney(p.spent);
  const label = `${p.name}${p.isNew ? ", новое" : ""}, ${visits}: ${amount}`;
  return (
    <View testID="place-row" accessible accessibilityLabel={label} style={[styles.row, !first && styles.divided]}>
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        {p.isNew && (
          <View style={styles.tag}>
            <Text style={styles.tagText}>новое</Text>
          </View>
        )}
        <Text style={styles.visits}>{`· ${visits}`}</Text>
      </View>
      <Text style={styles.sum}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.sm },
  eyebrow: { ...type.label, color: color.fg.subtle, paddingHorizontal: space.lg },
  // The app's solid card: no glass here (glass is only the limit card and floating things).
  card: {
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  row: { minHeight: touchMin, paddingVertical: space.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  left: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1 },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  visits: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  tag: { paddingHorizontal: space.xs + 2, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: color.fg.subtle },
  tagText: { ...type.caption, color: color.fg.muted },
  sum: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
