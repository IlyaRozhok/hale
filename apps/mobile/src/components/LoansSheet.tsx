import { type ReactNode, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { LoanRowDto } from "@hale/contracts";
import { useDeleteLoan, useLoanHistory, useRepayOldLoans } from "../api/queries";
import { formatMoney, shortDate } from "../format";
import { askDeleteLoan } from "./BadCaseCard";
import { ErrorText } from "./ErrorText";
import { RepayLoanSheet } from "./RepayLoanSheet";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

const nameOf = (l: LoanRowDto) => l.title ?? "Займ";

function detail(l: LoanRowDto): string {
  const base = `${formatMoney(l.amount)} от ${shortDate(l.receivedOn)}`;
  if (l.repaidOn !== null) {
    return `${base}, погашен${l.repaidDateKnown ? ` ${shortDate(l.repaidOn)}` : ", дата неизвестна"}${l.serviceCost > 0 ? `, ещё ${formatMoney(l.serviceCost)} на обслуживание` : ""}`;
  }
  return l.remaining < l.amount ? `${base}, осталось ${formatMoney(l.remaining)}` : base;
}

/** Every loan the app knows and what borrowing has cost so far. */
export function LoansSheet({ onClose }: { onClose: () => void }) {
  const history = useLoanHistory();
  const remove = useDeleteLoan();
  const repayOld = useRepayOldLoans();
  const [repaying, setRepaying] = useState<LoanRowDto | null>(null);
  const data = history.data;
  const total = data ? data.open.length + data.old.length + data.repaid.length : 0;

  const row = (l: LoanRowDto) => (
    <View key={l.id} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{nameOf(l)}</Text>
        <Text style={styles.detail}>{detail(l)}</Text>
      </View>
      {l.manual && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Удалить: ${nameOf(l)}`}
          onPress={() =>
            askDeleteLoan(nameOf(l), () =>
              remove.mutate(l.id, { onError: () => Alert.alert("Не удалось удалить займ", "Проверьте связь и попробуйте ещё раз.") }),
            )
          }
          style={styles.action}
        >
          <Text style={styles.deleteText}>Удалить</Text>
        </Pressable>
      )}
      {l.repaidOn === null && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Погасил: ${nameOf(l)}`} onPress={() => setRepaying(l)} style={styles.action}>
          <Text style={styles.actionText}>Погасил</Text>
        </Pressable>
      )}
    </View>
  );

  const section = (title: string, loans: LoanRowDto[], note?: string, action?: ReactNode) =>
    loans.length > 0 && (
      <View style={styles.section}>
        <Text style={styles.heading}>{title}</Text>
        {note && <Text style={styles.detail}>{note}</Text>}
        {action}
        {loans.map(row)}
      </View>
    );

  const askRepayOld = () =>
    Alert.alert("Все старые займы уже погашены?", "Они уйдут в погашенные без даты. На лимит это не влияет.", [
      { text: "Нет", style: "cancel" },
      {
        text: "Да, погашены",
        onPress: () =>
          repayOld.mutate(undefined, { onError: () => Alert.alert("Не удалось закрыть займы", "Проверьте связь и попробуйте ещё раз.") }),
      },
    ]);

  return (
    <Sheet title="Займы" onClose={onClose}>
      {history.isError && !data && (
        <>
          <ErrorText>Не получилось загрузить займы.</ErrorText>
          <Pressable accessibilityRole="button" onPress={() => void history.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </>
      )}
      {data && total === 0 && <Text style={styles.name}>Займов пока нет.</Text>}
      {data && total > 0 && (
        <>
          <View style={styles.section}>
            <Stat label="Взято" value={data.stats.borrowed} />
            <Stat label="Возвращено" value={data.stats.repaid} />
            <Stat label="На обслуживание" value={data.stats.serviceCost} />
            <Stat label="Открыто сейчас" value={data.stats.stillOpen} />
          </View>
          {section("Открытые", data.open)}
          {section(
            "До начала учёта",
            data.old,
            "Не входят в лимит. Банк не показывает, что они погашены.",
            <Pressable accessibilityRole="button" onPress={askRepayOld} disabled={repayOld.isPending} style={styles.retry}>
              <Text style={styles.retryText}>Все уже погашены</Text>
            </Pressable>,
          )}
          {section("Погашенные", data.repaid)}
        </>
      )}
      {/* Inside the list's modal: iOS presents it on top, and closing it returns to the list. */}
      {repaying && <RepayLoanSheet loanId={repaying.id} remaining={repaying.remaining} name={nameOf(repaying)} onClose={() => setRepaying(null)} />}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.detail}>{label}</Text>
      <Text style={styles.name}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { ...type.label, color: color.fg.muted },
  stat: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  rowText: { flex: 1 },
  name: { ...type.body, color: color.fg.default },
  detail: { ...type.caption, color: color.fg.muted },
  action: { minHeight: touchMin, justifyContent: "center" },
  actionText: { ...type.label, color: color.fg.default },
  deleteText: { ...type.label, color: color.fg.muted },
  retry: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  retryText: { ...type.label, color: color.accent.fgOnAccent },
});
