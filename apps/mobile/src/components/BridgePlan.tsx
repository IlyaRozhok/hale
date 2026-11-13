import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { tokens } from "@hale/tokens";
import type { DailyStateDto } from "@hale/contracts";
import { dateLabel, formatMoney, formatUsd } from "../format";
import { useBridgePreview } from "../api/queries";
import { ErrorText } from "./ErrorText";
import { Glass } from "./Glass";

const { color, radius, space, touchMin, type } = tokens;

const STEP = 5000; // ₴50
const MIN = 10000; // ₴100

type Props = {
  state: DailyStateDto;
  usdRate: number;
  /** The credit limit of the cards; 0 when there is none. */
  creditLimit?: number;
  onConfirm: (dailyAmount: number) => void;
  onCancel: () => void;
  confirming: boolean;
  /**
   * The day own money runs out (the runway's zero day), drawn for the day's current limit; null or
   * absent when there is none, or from an older server.
   */
  zeroOn?: string | null;
  /** Why the last confirm did not go through: an older server refuses a plan the credit limit does not cover. */
  confirmFailed?: "refused" | "failed" | null;
};

const roundToStep = (v: number) => Math.max(MIN, Math.round(v / STEP) * STEP);

const dayMonth = (iso: string) => dateLabel(iso).replace(/ \d{4}$/, "");

/**
 * The bridge plan: pick a daily amount, see what is missing until the income, confirm it. A plan the
 * credit limit does not cover is confirmed too (owner's decision, А22): the day gets its limit, and
 * a sand line says how much is missing and by when it is needed.
 */
export function BridgePlan({ state, usdRate, creditLimit = 0, onConfirm, onCancel, confirming, zeroOn = null, confirmFailed = null }: Props) {
  const base = state.bridge;
  // Unmoved, the slider shows the server's exact amount, so the numbers beside it are the server's too.
  // On the day the shortage came on the day still runs on its morning limit; the plan is the new one.
  const nextLimit = state.shortageStart?.nextLimit;
  const current = nextLimit !== undefined ? nextLimit : state.dailyLimit > 0 ? state.dailyLimit : (base?.recommendedDaily ?? MIN);
  const [moved, setMoved] = useState<number | null>(null);
  const value = moved ?? current;
  const changed = moved !== null && moved !== current;
  const preview = useBridgePreview(changed ? moved : null);
  if (!base) return null;

  const max = Math.max(Math.ceil((Math.max(base.recommendedDaily, base.maxDailyWithinCredit) * 2) / STEP) * STEP, MIN + STEP, value);
  const fresh = !changed || preview.data?.dailyAmount === moved;
  const shown = changed && preview.data ? preview.data : { creditNeeded: base.creditNeeded, shortfall: base.shortfall };
  const daily = formatUsd(value, usdRate);
  const needsAction = !base.confirmed || changed;
  const canConfirm = fresh && !confirming && !preview.failed;
  const short = !preview.failed && fresh && shown.shortfall > 0;
  // The zero day is drawn for the day's limit: it holds only while the slider shows that amount.
  const neededOn = zeroOn && value === state.dailyLimit ? dayMonth(zeroOn) : null;
  // One amount missing on the screen: the same one as in «Не хватает до дохода», never the part beyond the credit limit.
  const shortLine = !short
    ? null
    : needsAction
      ? `Не хватает ${formatMoney(shown.creditNeeded)}. ${neededOn ? `План можно подтвердить: лимит на день будет, а недостающее понадобится к ${neededOn}.` : "План можно подтвердить: лимит на день будет."}`
      : neededOn
        ? `Недостающее понадобится к ${neededOn}.`
        : null;
  const askCancel = () =>
    Alert.alert("Отменить план?", "Лимит на сегодня будет посчитан заново.", [
      { text: "Оставить", style: "cancel" },
      { text: "Отменить план", style: "destructive", onPress: onCancel },
    ]);

  return (
    <Glass style={styles.stack}>
      <Text style={styles.text}>До дохода {state.daysLeft} дн.</Text>
      <View style={styles.missing}>
        <View style={styles.line}>
          <Text style={styles.muted}>Не хватает до дохода</Text>
          <Text style={[styles.value, !fresh && styles.pending]}>{formatMoney(shown.creditNeeded)}</Text>
        </View>
        {/* Said only when it is true: there is a credit limit and the whole amount fits in it. */}
        {creditLimit > 0 && shown.creditNeeded > 0 && shown.shortfall === 0 && (
          <Text style={styles.caption}>Эту сумму можно закрыть из кредитного лимита.</Text>
        )}
      </View>
      <View style={styles.line}>
        <Text style={styles.muted}>В день</Text>
        <Text style={styles.value}>{daily ? `${formatMoney(value)} · ${daily}` : formatMoney(value)}</Text>
      </View>
      <Slider
        accessibilityLabel="Сумма в день"
        accessibilityValue={{ text: `${formatMoney(value)} в день` }}
        style={styles.slider}
        minimumValue={Math.min(MIN, value)}
        maximumValue={max}
        step={STEP}
        value={value}
        onValueChange={(v: number) => setMoved(roundToStep(v))}
        minimumTrackTintColor={color.fg.default}
        maximumTrackTintColor={color.data.track}
        thumbTintColor={color.fg.default}
      />
      {preview.failed && (
        <View style={styles.stack}>
          <ErrorText>Не удалось пересчитать</ErrorText>
          <Pressable accessibilityRole="button" onPress={preview.retry} style={styles.confirm}>
            <Text style={styles.confirmText}>Повторить</Text>
          </Pressable>
        </View>
      )}
      {shortLine && <Text style={styles.short}>{shortLine}</Text>}
      {needsAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canConfirm }}
          disabled={!canConfirm}
          onPress={() => onConfirm(value)}
          style={[styles.confirm, !canConfirm && styles.pending]}
        >
          <Text style={styles.confirmText}>{base.confirmed ? `Подтвердить ${formatMoney(value)} в день` : "Подтвердить план"}</Text>
        </Pressable>
      ) : (
        <Text style={styles.text} accessibilityRole="text">
          План подтверждён: {formatMoney(value)} в день. Сдвиньте ползунок, чтобы изменить.
        </Text>
      )}
      {needsAction && confirmFailed && (
        <Text style={styles.muted}>
          {confirmFailed === "refused"
            ? "Подтвердить такой план пока не получилось. Лимит на сегодня остаётся прежним."
            : "Не удалось подтвердить план. Проверьте связь и попробуйте ещё раз."}
        </Text>
      )}
      {base.confirmed && !changed && (
        <Pressable accessibilityRole="button" onPress={askCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>Отменить план</Text>
        </Pressable>
      )}
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  missing: { gap: space.xs },
  caption: { ...type.caption, color: color.fg.subtle },
  /** A warning, not an error: sand. */
  short: { ...type.body, color: color.limit.low },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  value: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  pending: { opacity: 0.6 },
  slider: { height: touchMin },
  confirm: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  confirmText: { ...type.label, color: color.accent.fgOnAccent },
  cancel: { minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  cancelText: { ...type.label, color: color.fg.muted },
});
