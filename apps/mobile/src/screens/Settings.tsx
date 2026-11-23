import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import type { LedgerCheckDto, LedgerCheckIssueDto } from "@hale/contracts";
import { tokens } from "@hale/tokens";
import { ErrorText } from "../components/ErrorText";
import { dayMonth, formatMoney, formatOriginal, formatStamp, kyivDate, pluralIndex } from "../format";
import { useCapPreview, useLedgerCheck, useSaveSettings, useSettings, useToday } from "../api/queries";
import { Glass } from "../components/Glass";
import { Icon } from "../components/Icon";
import { ActionRow } from "../components/ActionRow";
import { RulesSheet } from "../components/RulesSheet";
import { useSignOut } from "../session";

const { color, space, touchMin, type } = tokens;

/** The slider works in whole hryvnias; the API speaks kopecks. */
const CAP_MIN = 20_000;
const CAP_MAX = 300_000;
const CAP_STEP = 5_000;
/** Design §5.2: used until the owner sets a cap. */
const DEFAULT_CAP_KOPECKS = 10_000_000;
const SAVE_FAILED = "Не удалось сохранить. Значение возвращено.";

/** An amount of a discrepancy, without its sign: whole hryvnias, or the account's own currency with cents. */
const checkAmount = (minor: number, currency: string): string =>
  currency === "UAH" && Math.abs(minor) >= 100 ? formatMoney(Math.abs(minor)) : formatOriginal(Math.abs(minor), currency);

/** One discrepancy as a whole sentence with its values put in; null for a kind this app has no words for. */
function issueSentence(issue: LedgerCheckIssueDto, ranAt: string): string | null {
  const { day, month } = dayMonth(issue.since ?? kyivDate(new Date(ranAt)));
  const date = `${day} ${month}`;
  const amount = checkAmount(issue.amount, issue.currency);
  switch (issue.kind) {
    case "bank_balance":
      switch (issue.accountKind) {
        case "black":
          return `На чёрной карте не сходится ${amount} с ${date}.`;
        case "white":
          return `На белой карте не сходится ${amount} с ${date}.`;
        case "fop":
          return `На счёте ФОП не сходится ${amount} с ${date}.`;
        case "jar":
          return issue.accountTitle ? `В банке «${issue.accountTitle}» не сходится ${amount} с ${date}.` : `В банке не сходится ${amount} с ${date}.`;
        default:
          return `На одном из счетов не сходится ${amount} с ${date}.`;
      }
    case "own_transfers": {
      const n = issue.count ?? 0;
      return `У ${n} ${["перевода", "переводов", "переводов"][pluralIndex(n)]} между своими счетами нет второй части, с ${date}.`;
    }
    case "categories":
      return `С ${date} траты по категориям не сходятся с общей суммой на ${amount}.`;
    case "day_spent":
      return `Потрачено за ${date} не везде одинаково: разница ${amount}.`;
    case "cash_wallet":
      return `В кошельке наличных ${formatMoney(issue.amount)} с ${date}.`;
    default:
      return null;
  }
}

/**
 * The ledger check in Settings (task Б11): all is well, or the first discrepancy it can name and, as a sentence of
 * its own, how many more there are.
 */
export function ledgerCheckText(check: LedgerCheckDto): string {
  if (check.issues.length === 0) return "Сверка: всё сходится.";
  const named = check.issues.map((i) => issueSentence(i, check.ranAt));
  const first = named.find((s): s is string => s !== null) ?? "Сверка нашла расхождение.";
  const more = check.issues.length - 1;
  return more === 0 ? first : `${first} Ещё ${more} ${["расхождение", "расхождения", "расхождений"][pluralIndex(more)]}.`;
}

export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const save = useSaveSettings();
  // The cached Today answer already knows when the bank last answered; no request of its own kind.
  const today = useToday();
  const check = useLedgerCheck();
  const signOut = useSignOut();
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

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

  const confirmSignOut = () =>
    Alert.alert("Выйти из Hale?", "Чтобы войти снова, понадобится пароль.", [
      { text: "Отмена", style: "cancel" },
      { text: "Выйти", onPress: signOut },
    ]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            void settings.refetch();
            void check.refetch();
          }}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.head}>
        <Text style={styles.title}>Настройки</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.close}>
          <Icon name="close" color={color.fg.muted} />
        </Pressable>
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      {settings.isError && !saved && <ErrorText>Не получилось загрузить настройки.</ErrorText>}

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
                {preview.data.rateStale && <Text style={styles.muted}>Курс валюты неизвестен или устарел: цифра может быть неточной.</Text>}
              </View>
            ) : preview.failed ? (
              <ErrorText>Не удалось пересчитать.</ErrorText>
            ) : null}
          </Glass>
        </>
      )}
      <ActionRow label="Мои правила" onPress={() => setRulesOpen(true)} />
      {today.data && (
        <Text style={styles.muted}>
          {today.data.syncedAt ? `Банк обновлялся ${formatStamp(today.data.syncedAt)}` : "Синхронизации с банком ещё не было."}
        </Text>
      )}
      {check.data && <Text style={styles.muted}>{ledgerCheckText(check.data)}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Выйти" onPress={confirmSignOut} style={styles.signOut}>
        <Text style={styles.signOutText}>Выйти</Text>
      </Pressable>
      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}
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
  muted: { ...type.body, color: color.fg.muted, flexShrink: 1 },
  value: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  slider: { height: touchMin },
  stale: { opacity: 0.6 },
  signOut: { minWidth: touchMin, minHeight: touchMin, justifyContent: "center", alignSelf: "flex-start" },
  signOutText: { ...type.label, color: color.fg.default },
});
