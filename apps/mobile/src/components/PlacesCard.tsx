import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { InsightsMonthDto } from "@hale/contracts";
import { formatMoney, pluralIndex } from "../format";
import { InsetList, ListRow } from "./ListRow";

const { color, radius, space, type } = tokens;

export type Place = NonNullable<InsightsMonthDto["places"]>[number];

/** «1 раз», «2 раза», «5 раз», «22 раза». */
export const visitsText = (n: number): string => `${n} ${["раз", "раза", "раз"][pluralIndex(n)]}`;

/**
 * «Места» on «Итоги» (task В3; the screen's variant А shows them under the switch): the month's largest places by
 * sum, as the server sends them, up to five. The rows lead nowhere yet, so no chevron: «Операции» has no filter by
 * place. Nothing is drawn when there are no places.
 */
export function PlacesCard({ places }: { places: Place[] | undefined }) {
  if (!places || places.length === 0) return null;
  return (
    <InsetList testID="places-card">
      {places.map((p, i) => (
        <PlaceRow key={p.key} p={p} first={i === 0} />
      ))}
    </InsetList>
  );
}

function PlaceRow({ p, first }: { p: Place; first: boolean }) {
  const visits = visitsText(p.visits);
  const amount = formatMoney(p.spent);
  return (
    <ListRow
      testID="place-row"
      iconTestID="place-icon"
      icon="pin"
      title={p.name}
      tag={
        p.isNew ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>новое</Text>
          </View>
        ) : undefined
      }
      below={<Text style={styles.visits}>{visits}</Text>}
      amount={amount}
      accessibilityLabel={`${p.name}${p.isNew ? ", новое" : ""}, ${visits}: ${amount}`}
      first={first}
    />
  );
}

const styles = StyleSheet.create({
  visits: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  tag: { paddingHorizontal: space.xs + 2, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: color.fg.subtle },
  tagText: { ...type.caption, color: color.fg.muted },
});
