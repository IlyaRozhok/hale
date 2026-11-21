import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { ExpectedIncomeDto } from "@hale/contracts";
import { useCreateIncome, useDeleteIncome, useExpectedIncomes, useIncomeEvents, usePatchIncome, useSetIncomeDate } from "../api/queries";
import { parseHryvnias, shortDate } from "../format";
import { moneyIn, nextEvent } from "../planSummary";
import { Chip } from "./Chip";
import { CurrencyChoice } from "./CurrencyChoice";
import { DateField } from "./DateField";
import { EntryRow, askDelete } from "./EntryRow";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

const SOURCES = { fop: "ФОП", usdc: "USDC" } as const;

/** The income's own name (a server since Д3а gives one), else its old kind's. */
const incomeTitle = (i: ExpectedIncomeDto): string => i.name ?? (i.source ? SOURCES[i.source] : "");

const day = (text: string): number | null => {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

/** The incomes the plan expects, with the date of the next one. */
export function IncomesSheet({ onClose }: { onClose: () => void }) {
  const incomes = useExpectedIncomes();
  const events = useIncomeEvents();
  const remove = useDeleteIncome();
  const [editing, setEditing] = useState<ExpectedIncomeDto | "new" | null>(null);

  const detail = (i: ExpectedIncomeDto) => {
    const next = nextEvent(events.data ?? [], i.id);
    return `${moneyIn(i.amount, i.currency)}${next ? `, следующий ${shortDate(next.expected_on)}` : ""}`;
  };

  return (
    <Sheet title="Доходы" onClose={onClose}>
      {incomes.isError && !incomes.data && <ErrorText>Не получилось загрузить доходы.</ErrorText>}
      {incomes.data?.length === 0 && <Text style={styles.muted}>Доходы не указаны.</Text>}
      {incomes.data?.map((i) => (
        <EntryRow
          key={i.id}
          title={incomeTitle(i)}
          detail={detail(i)}
          onEdit={() => setEditing(i)}
          onDelete={() =>
            askDelete(incomeTitle(i), "Лимит будет посчитан без этого дохода.", () =>
              remove.mutate(i.id, { onError: () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.") }),
            )
          }
        />
      ))}
      <PrimaryButton label="Новый доход" onPress={() => setEditing("new")} />
      {editing && (
        <IncomeForm
          income={editing === "new" ? null : editing}
          nextId={editing === "new" ? undefined : nextEvent(events.data ?? [], editing.id)?.id}
          nextDate={editing === "new" ? undefined : nextEvent(events.data ?? [], editing.id)?.expected_on}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  );
}

type FormProps = { income: ExpectedIncomeDto | null; nextId?: number; nextDate?: string; onClose: () => void };

function IncomeForm({ income, nextId, nextDate, onClose }: FormProps) {
  const create = useCreateIncome();
  const patch = usePatchIncome();
  const setDate = useSetIncomeDate();
  const [source, setSource] = useState<"fop" | "usdc">(income?.source ?? "fop");
  const [amount, setAmount] = useState(income ? String(income.amount / 100) : "");
  const [currency, setCurrency] = useState(income?.currency ?? "UAH");
  const [from, setFrom] = useState(income ? String(income.window_start_day) : "");
  const [to, setTo] = useState(income ? String(income.window_end_day) : "");
  const [date, setDateValue] = useState(nextDate ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const minor = parseHryvnias(amount);
    const start = day(from);
    const end = day(to);
    if (minor === null || start === null || end === null || start > end) {
      setMessage("Проверьте сумму и числа.");
      return;
    }
    setMessage(null);
    setBusy(true);
    const values = { amount: minor, currency, window_start_day: start, window_end_day: end };
    try {
      if (income) await patch.mutateAsync({ id: income.id, patch: values });
      else await create.mutateAsync({ source, ...values });
      if (nextId !== undefined && date !== nextDate) await setDate.mutateAsync({ eventId: nextId, date });
      onClose();
    } catch {
      setMessage("Не удалось сохранить. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  return (
    <Sheet title={income ? incomeTitle(income) : "Новый доход"} onClose={onClose}>
      {!income && (
        <View style={styles.row}>
          {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((s) => (
            <Chip
              key={s}
              role="radio"
              label={SOURCES[s]}
              selected={source === s}
              onPress={() => {
                setSource(s);
                setCurrency(s === "usdc" ? "USD" : "UAH");
              }}
            />
          ))}
        </View>
      )}
      <Field label="Сумма дохода" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <CurrencyChoice value={currency} onChange={setCurrency} />
      <Text style={styles.muted}>Когда обычно приходит</Text>
      <View style={styles.row}>
        <View style={styles.half}>
          <Field label="С какого числа" value={from} onChangeText={setFrom} keyboardType="number-pad" />
        </View>
        <View style={styles.half}>
          <Field label="По какое число" value={to} onChangeText={setTo} keyboardType="number-pad" />
        </View>
      </View>
      {nextId !== undefined && <DateField label="Следующий доход" value={date} onChange={setDateValue} />}
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить доход" disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.body, color: color.fg.muted },
  row: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
});
