import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

type Props = {
  testID?: string;
  /** testID of the icon's square, for tests that check which icon a row has. */
  iconTestID?: string;
  icon: IconName;
  title: string;
  /** Next to the title, e.g. the tag «новое». */
  tag?: ReactNode;
  /** Under the title: a bar or a quiet second line. */
  below?: ReactNode;
  amount: string;
  accessibilityLabel: string;
  first: boolean;
  /** A row that leads somewhere is a button with a chevron; without it the row is plain text. */
  onPress?: () => void;
};

/**
 * One row of an inset list in the iOS manner («Итоги», variant А): an icon in a small rounded square, the name with
 * what goes under it, the amount on the right, and a chevron when the row leads somewhere.
 */
export function ListRow({ testID, iconTestID, icon, title, tag, below, amount, accessibilityLabel, first, onPress }: Props) {
  const body = (
    <>
      <View testID={iconTestID} style={styles.square}>
        <Icon name={icon} color={color.fg.muted} size={18} />
      </View>
      <View style={styles.middle}>
        <View style={styles.titleLine}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {tag}
        </View>
        {below}
      </View>
      <Text style={styles.amount}>{amount}</Text>
      {onPress && (
        <View testID="row-chevron">
          <Icon name="chevron" color={color.fg.subtle} size={16} />
        </View>
      )}
    </>
  );
  const style = [styles.row, !first && styles.divided];
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={style}>
      {body}
    </View>
  );
}

/** The solid card the rows sit in: no glass (glass is only the limit card and floating things). */
export function InsetList({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}

const SQUARE = 30;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    paddingLeft: space.md,
    paddingRight: space.sm,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  row: { minHeight: touchMin, paddingVertical: space.md, flexDirection: "row", alignItems: "center", gap: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  square: { width: SQUARE, height: SQUARE, borderRadius: radius.sm, backgroundColor: color.surface.raised, alignItems: "center", justifyContent: "center" },
  middle: { flex: 1, gap: space.xs },
  titleLine: { flexDirection: "row", alignItems: "center", gap: space.xs },
  title: { ...type.body, color: color.fg.default, flexShrink: 1 },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
