import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

type Props = {
  testID?: string;
  /** testID of the icon, for tests that check which icon a row has. */
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
 * One row of an inset list in the iOS manner («Итоги»): the icon as a bare glyph, the name with what goes under it,
 * the amount on the right, and a chevron when the row leads somewhere. The hairline above it starts at the text.
 */
export function ListRow({ testID, iconTestID, icon, title, tag, below, amount, accessibilityLabel, first, onPress }: Props) {
  const body = (
    <>
      <View testID={iconTestID} style={styles.icon}>
        <Icon name={icon} color={color.list.icon} size={18} />
      </View>
      <View testID="row-line" style={[styles.line, !first && styles.divided]}>
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
            <Icon name="chevron" color={color.list.chevron} size={16} />
          </View>
        )}
      </View>
    </>
  );
  const style = styles.row;
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

/** The solid card the rows sit in: no glass (glass is only the limit card and floating things), no line around it. */
export function InsetList({ testID, children }: { testID?: string; children: ReactNode }) {
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}

const ICON = 22;

const styles = StyleSheet.create({
  // No line around the card; the hairlines between rows run to its right edge, so the rows keep the room on the right.
  card: { borderRadius: radius.card, paddingLeft: space.lg, backgroundColor: color.card.fill, overflow: "hidden" },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "stretch", gap: space.md },
  icon: { width: ICON, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingRight: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  middle: { flex: 1, gap: space.xs },
  titleLine: { flexDirection: "row", alignItems: "center", gap: space.xs },
  title: { ...type.body, color: color.fg.default, flexShrink: 1 },
  amount: { ...type.body, color: color.list.value, fontVariant: ["tabular-nums"] },
});
