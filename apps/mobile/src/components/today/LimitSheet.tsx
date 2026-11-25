import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { tokens } from "@hale/tokens";
import { LIMIT_SHEET_TITLE, type LimitSheet as Model, type LimitSheetTerm } from "../../limitSheet";
import { Icon } from "../Icon";
import { Sheet } from "../Sheet";

const { color, space, touchMin, type } = tokens;

const PLAN_HINT = "Открывает план до дохода";

/**
 * What each share of the bar is drawn with: what is taken off the own money is grey, from the darkest; the free money
 * is the one sage. Each share has its name in the row under the bar, so colour is never the only sign.
 */
const SHARE: Record<LimitSheetTerm["key"] | "free", string> = {
  tax: color.data.grid,
  due: color.data.track,
  goal: color.data.target,
  borrowed: color.data.forecast,
  free: color.accent.signal,
};

type Props = {
  /** What to show: `limitSheet()` decides every line and figure; this component only draws them. */
  sheet: Model;
  onClose: () => void;
  /** Opens «План до дохода» from the line about the plan; without it that line is plain. */
  onOpenPlan?: () => void;
};

/**
 * «Как посчитан лимит» (task ЧЛ4): the own money, what is taken off it, the days the free money is spread over, the
 * rule that gave the limit, what is spent today and the figure of the screen. Read-only, top to bottom as the
 * computation goes.
 *
 * Contract:
 * - Every row is one element for VoiceOver, named with its words and its figure.
 * - The bar and the dots are drawn only when the model says the terms are shares of a whole (`sheet.bar`); the day
 *   cells only when it counts them (`days.cells`).
 * - One accent, the sage: the free money and today's cell. What is missing is sand. Nothing here is red.
 */
export function LimitSheet({ sheet, onClose, onOpenPlan }: Props) {
  const { own, terms, free, days, rule } = sheet;
  const dot = (key: keyof typeof SHARE) => (sheet.bar ? <View testID={`limit-sheet-dot-${key}`} style={[styles.dot, { backgroundColor: SHARE[key] }]} /> : null);
  const last = terms.length;
  return (
    <Sheet title={LIMIT_SHEET_TITLE} onClose={onClose}>
      <View style={styles.body}>
        <Row label={own.label} value={own.value} valueStyle={styles.figure} />
        {sheet.bar && (
          <View testID="limit-sheet-bar" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bar}>
            {terms.map((t, i) => (
              <View key={t.key} testID={`limit-sheet-share-${t.key}`} style={[styles.share, { flexGrow: t.amount, backgroundColor: SHARE[t.key] }, i === 0 && styles.shareFirst]} />
            ))}
            <View testID="limit-sheet-share-free" style={[styles.share, { flexGrow: free.amount, backgroundColor: SHARE.free }, last === 0 && styles.shareFirst, styles.shareLast]} />
          </View>
        )}
        <View style={styles.terms}>
          {terms.map((t) => (
            <Row key={t.key} label={t.label} value={t.value} before={dot(t.key)} />
          ))}
          <Row label={free.label} value={free.value} before={dot("free")} labelStyle={styles.strong} valueStyle={free.short ? styles.short : styles.free} />
        </View>

        {days && (
          <View style={styles.block}>
            <Row label={days.label} value={days.value} />
            {days.cells !== null && (
              <View style={styles.cellsBlock}>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.cells}>
                  {Array.from({ length: days.cells }, (_, i) => (
                    <View key={i} testID="limit-sheet-cell" style={[styles.cell, i === 0 && styles.cellToday]} />
                  ))}
                </View>
                <View style={styles.cellCaptions}>
                  <Text style={styles.quiet}>{days.start}</Text>
                  {days.end !== null && <Text style={styles.quiet}>{days.end}</Text>}
                </View>
              </View>
            )}
            {days.note !== null && <Text style={styles.quiet}>{days.note}</Text>}
          </View>
        )}

        <View style={styles.block}>
          {rule?.text != null && <Text style={styles.text}>{rule.text}</Text>}
          {rule &&
            (rule.plan && onOpenPlan ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${rule.label} ${rule.value}`} accessibilityHint={PLAN_HINT} onPress={onOpenPlan} style={styles.link}>
                <Text style={[styles.label, styles.strong]}>{rule.label}</Text>
                <Text style={styles.value}>{rule.value}</Text>
                <Icon name="chevron" color={color.list.chevron} size={14} />
              </Pressable>
            ) : rule.value === null ? (
              <Text style={styles.label}>{rule.label}</Text>
            ) : (
              <Row label={rule.label} value={rule.value} valueStyle={styles.strong} />
            ))}
          <Row label={sheet.spent.label} value={sheet.spent.value} />
          <View style={styles.total}>
            <Row label={sheet.total.label} value={sheet.total.value} labelStyle={styles.totalText} valueStyle={styles.totalText} />
          </View>
        </View>

        {sheet.notes.length > 0 && (
          <View style={styles.notes}>
            {sheet.notes.map((note) => (
              <Text key={note} style={styles.quiet}>
                {note}
              </Text>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** Words on the left, a figure on the right; one element for VoiceOver. The words wrap, the figure never gives way. */
function Row({
  label,
  value,
  before,
  labelStyle,
  valueStyle,
}: {
  label: string;
  value: string;
  before?: ReactNode;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View accessible accessibilityLabel={`${label} ${value}`} style={styles.row}>
      {before}
      <Text style={[styles.label, labelStyle]}>{label}</Text>
      <Text style={[styles.value, valueStyle]}>{value}</Text>
    </View>
  );
}

const BAR = 12;
const BAR_RADIUS = 5;
const CELL = 28;
const CELL_RADIUS = 7;
const DOT = 8;

const styles = StyleSheet.create({
  body: { gap: space.sm, paddingBottom: space.sm },
  block: { marginTop: space.md, gap: space.sm },
  terms: { gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { ...type.label, fontWeight: "400", color: color.fg.muted, flex: 1 },
  value: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"] },
  figure: { fontSize: 15, color: color.fg.default },
  strong: { color: color.fg.default },
  free: { color: color.accent.signal },
  short: { color: color.limit.low },
  text: { ...type.label, fontWeight: "400", color: color.fg.default },
  quiet: { ...type.caption, color: color.fg.subtle },
  bar: { flexDirection: "row", gap: 2, height: BAR },
  share: { flexBasis: 0, minWidth: 2, height: BAR },
  shareFirst: { borderTopLeftRadius: BAR_RADIUS, borderBottomLeftRadius: BAR_RADIUS },
  shareLast: { borderTopRightRadius: BAR_RADIUS, borderBottomRightRadius: BAR_RADIUS },
  dot: { width: DOT, height: DOT, borderRadius: 2 },
  cellsBlock: { gap: space.xs },
  cells: { flexDirection: "row", gap: 3 },
  cell: { flex: 1, height: CELL, borderRadius: CELL_RADIUS, backgroundColor: color.data.shares[4] },
  cellToday: { backgroundColor: color.accent.signal, borderWidth: 2, borderColor: color.fg.default },
  cellCaptions: { flexDirection: "row", justifyContent: "space-between" },
  link: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.sm },
  total: { marginTop: space.xs, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.data.grid },
  totalText: { fontSize: 15, fontWeight: "600", color: color.fg.default },
  notes: { marginTop: space.xs, gap: space.xs },
});
