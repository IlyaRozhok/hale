import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { tokens } from "@tablo/tokens";
import type { DailyStateDto } from "@tablo/contracts";
import { formatMoney, formatUsd } from "../format";
import { useBridgePreview } from "../api/queries";
import { Glass } from "./Glass";

const { color, radius, space, touchMin, type } = tokens;

const STEP = 5000; // ₴50
const MIN = 10000; // ₴100

type Props = {
  state: DailyStateDto;
  usdRate: number;
  onConfirm: (dailyAmount: number) => void;
  confirming: boolean;
};

const roundToStep = (v: number) => Math.max(MIN, Math.round(v / STEP) * STEP);

/** The bridge plan: pick a daily amount, see the credit it needs, confirm if it fits the limit. */
export function BridgePlan({ state, usdRate, onConfirm, confirming }: Props) {
  const base = state.bridge;
  const initial = state.dailyLimit > 0 ? state.dailyLimit : (base?.recommendedDaily ?? MIN);
  const [moved, setMoved] = useState<number | null>(null);
  const value = moved ?? roundToStep(initial);
  const preview = useBridgePreview(moved);
  if (!base) return null;

  const max = Math.ceil((Math.max(base.recommendedDaily, base.maxDailyWithinCredit) * 2) / STEP) * STEP;
  const fresh = moved === null || preview?.dailyAmount === moved;
  const shown = moved !== null && preview ? preview : { creditNeeded: base.creditNeeded, shortfall: base.shortfall };
  const daily = formatUsd(value, usdRate);

  return (
    <Glass style={styles.stack}>
      <Text style={styles.text}>До зарплаты {state.daysLeft} дн.</Text>
      <View style={styles.line}>
        <Text style={styles.muted}>Нужно из кредитки</Text>
        <Text style={[styles.value, !fresh && styles.pending]}>{formatMoney(shown.creditNeeded)}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.muted}>В день</Text>
        <Text style={styles.value}>{daily ? `${formatMoney(value)} · ${daily}` : formatMoney(value)}</Text>
      </View>
      <Slider
        accessibilityLabel="Сумма в день"
        style={styles.slider}
        minimumValue={MIN}
        maximumValue={Math.max(max, MIN + STEP)}
        step={STEP}
        value={value}
        onValueChange={(v: number) => setMoved(roundToStep(v))}
        minimumTrackTintColor={color.fg.default}
        maximumTrackTintColor={color.data.track}
        thumbTintColor={color.fg.default}
      />
      {fresh && shown.shortfall > 0 ? (
        <Text style={styles.text}>
          Не хватает {formatMoney(shown.shortfall)}: столько выходит за кредитный лимит. Попробуйте сумму поменьше.
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !fresh || confirming }}
          disabled={!fresh || confirming}
          onPress={() => onConfirm(value)}
          style={[styles.confirm, (!fresh || confirming) && styles.pending]}
        >
          <Text style={styles.confirmText}>Подтвердить план</Text>
        </Pressable>
      )}
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
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
});
