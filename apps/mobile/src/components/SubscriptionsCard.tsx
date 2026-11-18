import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { isActive, monthlyText, SubscriptionsSheet, subscriptionsNote, type Subscriptions } from "./SubscriptionsSheet";

const { color, radius, space, touchMin, type } = tokens;

/**
 * «Подписки» on «Итоги» (task В4, variant Б): one row with the total a month and, when something changed, one quiet
 * note; a tap opens the list. Nothing is drawn for an older server, or when no subscription is still charged.
 */
export function SubscriptionsCard({ subscriptions }: { subscriptions: Subscriptions | undefined }) {
  const [open, setOpen] = useState(false);
  if (!subscriptions || !subscriptions.items.some(isActive)) return null;
  const monthly = monthlyText(subscriptions);
  const note = subscriptionsNote(subscriptions.items);
  return (
    <>
      <View testID="subscriptions-card" style={styles.card}>
        <Pressable
          testID="subscriptions-row"
          accessibilityRole="button"
          accessibilityLabel={`Подписки: ${monthly}${note ? `. ${note}` : ""}`}
          onPress={() => setOpen(true)}
          style={styles.row}
        >
          <View style={styles.line}>
            <Text style={styles.name}>Подписки</Text>
            <View style={styles.right}>
              <Text style={styles.sum}>{monthly}</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </View>
          {note && <Text style={styles.note}>{note}</Text>}
        </Pressable>
      </View>
      {open && <SubscriptionsSheet subscriptions={subscriptions} onClose={() => setOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  // The app's solid card, as «Места»: no glass here.
  card: {
    marginTop: space.sm,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  row: { minHeight: touchMin, paddingVertical: space.md, justifyContent: "center", gap: space.xs },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  name: { ...type.body, color: color.fg.default, flexShrink: 1 },
  right: { flexDirection: "row", gap: space.xs },
  sum: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  chevron: { ...type.body, color: color.fg.muted },
  note: { ...type.caption, color: color.fg.muted, fontVariant: ["tabular-nums"] },
});
