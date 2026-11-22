import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { dayMonth, dayMonthLong } from "../format";
import { Icon, type IconName } from "./Icon";

const { color, radius, space, touchMin, type } = tokens;

/** Rows one under another, a hairline between them, as in an inset grouped list of iOS. */
export function ListRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <>
      {rows.map((row, i) => (
        <View key={isValidElement(row) && row.key !== null ? row.key : i} style={i > 0 ? styles.divided : undefined}>
          {row}
        </View>
      ))}
    </>
  );
}

/**
 * One section of «План» (variant А): a small upper-case header, the rows on a solid card, and a quiet footer under it.
 * A section with no rows is not drawn.
 */
export function PlanSection({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.header}>{title}</Text>
      <View style={styles.card}>
        <ListRows>{children}</ListRows>
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

/** A row: an icon in a small rounded square, the name, the value on the right and a chevron when it opens something. */
export function ListRow({ icon, label, subtitle, value, quiet, onPress }: RowProps) {
  const body = (
    <>
      {icon ? (
        <View style={styles.icon}>
          <Icon name={icon} color={color.fg.muted} size={18} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={quiet ? styles.count : styles.value}>{value}</Text> : null}
      {onPress ? <Icon name="chevron" color={color.fg.subtle} size={16} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  // The value is read after the name, then the line under it.
  const hint = [value, subtitle].filter(Boolean).join(", ") || undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.row}>
      {body}
    </Pressable>
  );
}

/** A row of «До дохода»: the day in bold over its short month, what happens, and its amount; money in is sage. */
export function DateRow({ date, label, value, income }: { date: string; label: string; value?: string; income?: boolean }) {
  const { day, month } = dayMonth(date);
  // Read as one whole, with the month in full: «6 декабря, Квартплата, −₴8,000».
  const spoken = [dayMonthLong(date), label, ...(value ? [value] : [])].join(", ");
  return (
    <View accessible accessibilityLabel={spoken} style={styles.row}>
      <View style={styles.date}>
        <Text style={styles.day}>{day}</Text>
        <Text style={styles.month}>{month}</Text>
      </View>
      <Text style={[styles.label, styles.text]} numberOfLines={1}>
        {label}
      </Text>
      {value ? <Text style={[styles.value, income && styles.income]}>{value}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  header: { ...type.caption, color: color.fg.subtle, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: space.lg },
  footer: { ...type.caption, color: color.fg.subtle, paddingHorizontal: space.lg },
  // The app's solid card: no glass on a list (glass is only the limit card and floating things).
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.card.edge },
  row: { minHeight: touchMin + space.sm, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  icon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: color.surface.raised },
  text: { flex: 1 },
  label: { ...type.body, color: color.fg.default },
  subtitle: { ...type.caption, color: color.fg.muted },
  value: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  count: { ...type.body, color: color.fg.muted, fontVariant: ["tabular-nums"] },
  income: { color: color.money.income },
  date: { width: 32 },
  day: { ...type.label, fontWeight: "600", color: color.fg.default, fontVariant: ["tabular-nums"] },
  month: { ...type.caption, color: color.fg.muted },
});
