import { type ReactNode, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { LoanRowDto } from "@hale/contracts";
import { useDeleteLoan, useLoanHistory, usePatchLoan, useRepayOldLoans } from "../api/queries";
import { formatMoney, shortDate } from "../format";
import { DateField } from "./DateField";
import { ErrorText } from "./ErrorText";
import { Icon } from "./Icon";
import { ManualLoanSheet } from "./ManualLoan";
import { PrimaryButton } from "./PrimaryButton";
import { RepayLoanSheet } from "./RepayLoanSheet";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

const nameOf = (l: LoanRowDto) => l.title ?? "Займ";

/** Removing a loan is only for a mistaken entry (or a bank row no longer a loan, Б48), so it asks first. */
function askDeleteLoan(text: string, onDelete: () => void): void {
  Alert.alert("Удалить ошибочную запись?", `${text}. Если займ настоящий, отметьте его погашенным.`, [
    { text: "Оставить", style: "cancel" },
    { text: "Удалить", style: "destructive", onPress: onDelete },
  ]);
}

function detail(l: LoanRowDto): string {
  const base = `${formatMoney(l.amount)} от ${shortDate(l.receivedOn)}`;
  if (l.repaidOn !== null) {
    return `${base}, погашен${l.repaidDateKnown ? ` ${shortDate(l.repaidOn)}` : ", дата неизвестна"}${l.serviceCost > 0 ? `, ещё ${formatMoney(l.serviceCost)} на обслуживание` : ""}`;
  }
  return l.remaining < l.amount ? `${base}, осталось ${formatMoney(l.remaining)}` : base;
}

/**
 * Every loan the app knows. No totals for the whole history on top (ЯМ4): with a loan open only «Открыто сейчас»,
 * and what servicing cost is one quiet line at the end of the unfolded history.
 */
export function LoansSheet({ onClose }: { onClose: () => void }) {
  const history = useLoanHistory();
  const remove = useDeleteLoan();
  const repayOld = useRepayOldLoans();
  const [repaying, setRepaying] = useState<LoanRowDto | null>(null);
  const [adding, setAdding] = useState(false);
  // Repaid loans can run to dozens (Б57): they wait under one quiet row, like «Ещё» in Plan, and unfold on a press.
  const [repaidShown, setRepaidShown] = useState(false);
  const data = history.data;
  const total = data ? data.open.length + data.old.length + data.repaid.length : 0;

  const row = (l: LoanRowDto, due = false) => (
    <View key={l.id} style={styles.loan}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.name}>{nameOf(l)}</Text>
          <Text style={styles.detail}>{detail(l)}</Text>
        </View>
        {(l.removable ?? l.manual) && (
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
      {/* An older server has no return date and could not keep one. */}
      {due && l.dueOn !== undefined && <DueDate loan={l} />}
    </View>
  );

  const section = (title: string, loans: LoanRowDto[], note?: string, action?: ReactNode, due = false) =>
    loans.length > 0 && (
      <View style={styles.section}>
        <Text style={styles.heading}>{title}</Text>
        {note && <Text style={styles.detail}>{note}</Text>}
        {action}
        {loans.map((l) => row(l, due))}
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
          {data.open.length > 0 && <Stat label="Открыто сейчас" value={data.stats.stillOpen} />}
          {section("Открытые", data.open, undefined, undefined, true)}
          {/* Old loans not yet marked repaid are still unpaid: the line would be untrue next to them. */}
          {data.open.length === 0 && data.old.length === 0 && <Text style={styles.name}>Открытых займов нет.</Text>}
          {section(
            "До начала учёта",
            data.old,
            "Не входят в лимит. Банк не показывает, что они погашены.",
            <Pressable accessibilityRole="button" onPress={askRepayOld} disabled={repayOld.isPending} style={styles.quiet}>
              <Text style={styles.actionText}>Все уже погашены</Text>
            </Pressable>,
          )}
          {repaidShown
            ? data.repaid.length > 0 && (
                <View style={styles.section}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Свернуть погашенные"
                    accessibilityState={{ expanded: true }}
                    onPress={() => setRepaidShown(false)}
                    style={[styles.quiet, styles.fold]}
                  >
                    <Text style={styles.heading}>Погашенные</Text>
                    <View style={styles.down}>
                      <Icon name="chevron" color={color.list.chevron} size={14} />
                    </View>
                  </Pressable>
                  {data.repaid.map((l) => row(l))}
                  {data.stats.serviceCost > 0 && (
                    <Text style={styles.detail}>{`На обслуживание ушло ${formatMoney(data.stats.serviceCost)} за всё время.`}</Text>
                  )}
                </View>
              )
            : data.repaid.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Погашенные, ${data.repaid.length}`}
                  accessibilityState={{ expanded: false }}
                  onPress={() => setRepaidShown(true)}
                  style={[styles.quiet, styles.fold]}
                >
                  <Text style={styles.more}>{`Погашенные · ${data.repaid.length}`}</Text>
                  <Icon name="chevron" color={color.list.chevron} size={14} />
                </Pressable>
              )}
        </>
      )}
      <PrimaryButton label="Новый займ" onPress={() => setAdding(true)} />
      {/* Inside the list's modal: iOS presents them on top, and closing returns to the list. */}
      {repaying && <RepayLoanSheet loanId={repaying.id} remaining={repaying.remaining} receivedOn={repaying.receivedOn} name={nameOf(repaying)} onClose={() => setRepaying(null)} />}
      {adding && <ManualLoanSheet onClose={() => setAdding(false)} />}
    </Sheet>
  );
}

/**
 * «Вернуть до» (task Б7): with a date the loan is kept for like a payment on that day; without one it stays
 * in the limit until it is repaid. Saved as soon as it is picked or cleared.
 */
function DueDate({ loan }: { loan: LoanRowDto }) {
  const patch = usePatchLoan();
  const save = (due_on: string | null) =>
    patch.mutate(
      { id: loan.id, input: { due_on } },
      { onError: () => Alert.alert("Не удалось сохранить срок", "Проверьте связь и попробуйте ещё раз.") },
    );
  return (
    <View style={styles.due}>
      <DateField
        label="Вернуть до"
        accessibilityName={`Вернуть до, ${nameOf(loan)}, ${detail(loan)}`}
        value={loan.dueOn ?? ""}
        onChange={save}
        min={loan.receivedOn}
      />
      {!!loan.dueOn && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Убрать срок: ${nameOf(loan)}`}
          onPress={() => save(null)}
          disabled={patch.isPending}
          style={styles.quiet}
        >
          <Text style={styles.deleteText}>Убрать срок</Text>
        </Pressable>
      )}
    </View>
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
  loan: { gap: space.xs },
  row: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  due: { gap: space.xs },
  rowText: { flex: 1 },
  name: { ...type.body, color: color.fg.default },
  detail: { ...type.caption, color: color.fg.muted },
  action: { minHeight: touchMin, justifyContent: "center" },
  actionText: { ...type.label, color: color.fg.default },
  deleteText: { ...type.label, color: color.fg.muted },
  quiet: { minHeight: touchMin, justifyContent: "center" },
  fold: { flexDirection: "row", alignItems: "center", gap: space.xs },
  down: { transform: [{ rotate: "90deg" }] },
  more: { ...type.caption, color: color.fg.subtle },
  retry: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  retryText: { ...type.label, color: color.accent.fgOnAccent },
});
