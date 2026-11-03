import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { tokens } from "@hale/tokens";
import { formatMoney } from "../format";
import { useCapPreview, useSaveSettings, useSettings } from "../api/queries";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";

const { color, space, touchMin, type } = tokens;

/** The slider works in whole hryvnias; the API speaks kopecks. */
const CAP_MIN = 20_000;
const CAP_MAX = 300_000;
const CAP_STEP = 5_000;
/** Design §5.2: used until the owner sets a cap. */
const DEFAULT_CAP_KOPECKS = 10_000_000;
const SAVE_FAILED = "Не удалось сохранить. Значение возвращено.";

export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saved = settings.data;
  const savedCap = saved ? (saved.lifestyle_cap > 0 ? saved.lifestyle_cap : DEFAULT_CAP_KOPECKS) / 100 : null;
  const cap = draft ?? savedCap;
  const preview = useCapPreview(cap === null ? null : cap * 100);

  const persist = (patch: Parameters<typeof save.mutate>[0], onDone?: () => void) => {
    setError(null);
    save.mutate(patch, {
      onError: () => setError(SAVE_FAILED),
      onSettled: onDone,
    });
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void settings.refetch()} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.head}>
        <Text style={styles.title}>Настройки</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.close}>
          <Icon name="close" color={color.fg.muted} />
        </Pressable>
      </View>
      {error && <Text style={styles.text}>{error}</Text>}
      {settings.isError && !saved && <Text style={styles.muted}>Не получилось загрузить настройки.</Text>}

      {saved && cap !== null && (
        <>
          <Glass style={styles.stack}>
            <Text style={styles.heading}>Потолок трат</Text>
            <Text style={styles.value}>{`${formatMoney(cap * 100)} в месяц`}</Text>
            <Slider
              accessibilityLabel="Потолок трат в месяц"
              accessibilityValue={{ text: `${formatMoney(cap * 100)} в месяц` }}
              style={styles.slider}
              minimumValue={Math.min(CAP_MIN, cap)}
              maximumValue={Math.max(CAP_MAX, cap)}
              step={CAP_STEP}
              value={cap}
              onValueChange={(v: number) => setDraft(v)}
              onSlidingComplete={(v: number) => persist({ lifestyle_cap: Math.round(v) * 100 }, () => setDraft(null))}
              minimumTrackTintColor={color.fg.default}
              maximumTrackTintColor={color.data.track}
              thumbTintColor={color.fg.default}
            />
            {preview.data ? (
              <View style={[styles.stack, preview.stale && styles.stale]}>
                <View style={styles.line}>
                  <Text style={styles.muted}>Дневной лимит при таком потолке</Text>
                  <Text style={styles.value}>{formatMoney(preview.data.dailyLimit)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={styles.muted}>Останется на цели в месяц</Text>
                  <Text style={styles.value}>{formatMoney(preview.data.leftForGoalsMonthly)}</Text>
                </View>
                {preview.data.rateStale && <Text style={styles.muted}>Курс валюты неизвестен или устарел: цифра может быть неточной.</Text>}
              </View>
            ) : preview.failed ? (
              <Text style={styles.muted}>Не удалось пересчитать.</Text>
            ) : null}
          </Glass>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base },
  content: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { minWidth: touchMin, minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  title: { ...type.title, color: color.fg.default },
  stack: { gap: space.md },
  heading: { ...type.title, color: color.fg.default },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted, flexShrink: 1 },
  value: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  slider: { height: touchMin },
  stale: { opacity: 0.6 },
});
