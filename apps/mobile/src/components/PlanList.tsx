import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { dayMonth, dayMonthLong } from "../format";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

/**
 * Where a row stands in its list: whether a hairline goes above it, and how far its right side keeps from the edge.
 * The row draws the line itself, so that it starts at the text and not under the icon.
 */
const Place = createContext({ divided: false, padRight: 0 });

/**
 * Rows one under another, a hairline between them, as in an inset grouped list of iOS. On a card the lines run to
 * its right edge, so the rows keep their own room on the right (`padRight`).
 */
export function ListRows({ children, padRight = 0 }: { children: ReactNode; padRight?: number }) {
  const rows = Children.toArray(children);
  return (
    <>
      {rows.map((row, i) => (
        <Place.Provider key={isValidElement(row) && row.key !== null ? row.key : i} value={{ divided: i > 0, padRight }}>
          {row}
        </Place.Provider>
      ))}
    </>
  );
}

/**
 * One section of «План»: a small upper-case header, the rows on a solid card, and a quiet footer under it.
 * A section with no rows is not drawn.
 */
export function PlanSection({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.header}>{title}</Text>
      <View testID="plan-card" style={styles.card}>
        <ListRows padRight={space.lg}>{children}</ListRows>
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

type RowProps = {
  icon?: IconName;
  label: string;
  /** A quiet line under the name. */
  subtitle?: string | null;
  /** What stands on the right: an amount, or a short count. */
  value?: string;
  /** A count or a word rather than money: drawn quieter. */
  quiet?: boolean;
  /** Without it the row opens nothing and has no chevron. */
  onPress?: () => void;
};

/** A row: the icon as a bare glyph, the name, the value on the right and a chevron when it opens something. */
export function ListRow({ icon, label, subtitle, value, quiet, onPress }: RowProps) {
  const { divided, padRight } = useContext(Place);
  const body = (
    <>
      {icon ? (
        <View testID="row-icon" style={styles.icon}>
          <Icon name={icon} color={color.list.icon} size={18} />
        </View>
      ) : null}
      <View testID="row-line" style={[styles.line, { paddingRight: padRight }, divided && styles.divided]}>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {value ? <Text style={quiet ? styles.count : styles.value}>{value}</Text> : null}
        {onPress ? <Icon name="chevron" color={color.list.chevron} size={16} /> : null}
      </View>
    </>
  );
  if (!onPress) return <View testID="plan-row" style={styles.row}>{body}</View>;
  // The value is read after the name, then the line under it.
  const hint = [value, subtitle].filter(Boolean).join(", ") || undefined;
  return (
    <Pressable testID="plan-row" accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.row}>
      {body}
    </Pressable>
  );
}

/** A row of «До дохода»: the date on one line, «6 дек», in its own column, what happens, and its amount; money in is sage. */
export function DateRow({ date, label, value, income }: { date: string; label: string; value?: string; income?: boolean }) {
  const { divided, padRight } = useContext(Place);
  const { day, month } = dayMonth(date);
  // Read as one whole, with the month in full: «6 декабря, Квартплата, −₴8,000».
  const spoken = [dayMonthLong(date), label, ...(value ? [value] : [])].join(", ");
  return (
    <View testID="date-row" accessible accessibilityLabel={spoken} style={[styles.dateRow, { paddingRight: padRight }, divided && styles.divided]}>
      <View testID={`date-column-${date}`} style={styles.date}>
        <Text style={styles.dateText} numberOfLines={1}>{`${day} ${month}`}</Text>
      </View>
      <Text style={[styles.label, styles.text]} numberOfLines={1}>
        {label}
      </Text>
      {value ? <Text style={[styles.amount, income && styles.income]}>{value}</Text> : null}
    </View>
  );
}

const ICON = 22;

const styles = StyleSheet.create({
  section: { gap: space.sm },
  header: { ...type.caption, color: color.list.secondary, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: space.lg },
  footer: { ...type.caption, color: color.list.secondary, paddingHorizontal: space.lg },
  // The app's solid card: no glass on a list (glass is only the limit card and floating things), and no line around it.
  card: { borderRadius: radius.card, paddingLeft: space.lg, backgroundColor: color.card.fill, overflow: "hidden" },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  row: { minHeight: touchMin + space.sm, flexDirection: "row", alignItems: "stretch", gap: space.md },
  icon: { width: ICON, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  // The whole row is the line here: its hairline starts at the card's left padding, across the date.
  dateRow: { minHeight: touchMin + space.sm, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  text: { flex: 1 },
  label: { ...type.body, color: color.fg.default },
  subtitle: { ...type.caption, color: color.list.secondary },
  value: { ...type.body, color: color.list.value, fontVariant: ["tabular-nums"] },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  count: { ...type.body, color: color.list.secondary, fontVariant: ["tabular-nums"] },
  income: { color: color.money.income },
  // At least 56pt so dates line up at the default size; larger text widens the column instead of cutting the date.
  date: { minWidth: 56 },
  dateText: { ...type.body, color: color.list.secondary, fontVariant: ["tabular-nums"] },
});
