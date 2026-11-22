import { useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { ExpectedIncomeDto, IncomeAccount, IncomeSchedule, OwnMoneyItemDto } from "@hale/contracts";
import { useCreateIncome, useDeleteIncome, useExpectedIncomes, useIncomeEvents, usePatchIncome, useSetIncomeDate, useToday } from "../api/queries";
import { parseHryvnias } from "../format";
import { hasNamedIncomes, incomeDetail, incomePlaces, nextEvent, nextIncomeLine, sameAccount } from "../planSummary";
import { Chip } from "./Chip";
import { CurrencyChoice } from "./CurrencyChoice";
import { DateField } from "./DateField";
import { askDelete } from "./EntryRow";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import { SummaryRow } from "./SummaryRow";

const { color, radius, space, touchMin, type } = tokens;

const SOURCES = { fop: "ФОП", usdc: "USDC" } as const;
const SOURCE_OPTIONS = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((s) => ({ key: s, label: SOURCES[s] }));
const SCHEDULES: { value: IncomeSchedule; label: string }[] = [
  { value: "monthly", label: "Раз в месяц" },
  { value: "twice", label: "Два раза в месяц" },
  { value: "none", label: "Без расписания" },
];
const TAX = "С этого дохода платится налог ФОП";
const CRYPTO = "Приходит в крипте — спросить о выводе";
const SAVE_FAILED = "Не удалось сохранить. Попробуйте ещё раз.";

/** The income's own name (a server since Д3а gives one), else its old kind's. */
const incomeTitle = (i: ExpectedIncomeDto): string => i.name ?? (i.source ? SOURCES[i.source] : "");

const day = (text: string): number | null => {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

/** Minor units as the text a person would type: 500000 -> "5000", 75050 -> "750.5". */
const amountText = (minor: number): string => String(minor / 100);

/**
 * «Доходы» (Д3б, variant А): one row per income — its name, amount, when and where it comes — and the next income
 * under the list. A row opens the income's form. A server older than Д3а names no income: then the old form.
 */
export function IncomesSheet({ onClose }: { onClose: () => void }) {
  const incomes = useExpectedIncomes();
  const events = useIncomeEvents();
  const today = useToday();
  const [editing, setEditing] = useState<ExpectedIncomeDto | "new" | null>(null);
  const items: OwnMoneyItemDto[] = [...(today.data?.accounts.items ?? []), ...(today.data?.accounts.setAside ?? [])];
  const named = hasNamedIncomes(incomes.data ?? []);
  const next = incomes.data && events.data ? nextIncomeLine(incomes.data, events.data) : null;
  const income = editing === "new" ? null : editing;
  const nextOfIncome = income ? nextEvent(events.data ?? [], income.id) : undefined;

  return (
    <Sheet title="Доходы" onClose={onClose}>
      {incomes.isError && !incomes.data && <ErrorText>Не получилось загрузить доходы.</ErrorText>}
      {incomes.data?.length === 0 && <Text style={styles.muted}>Доходы не указаны.</Text>}
      {incomes.data && incomes.data.length > 0 && (
        <View style={styles.list}>
          {incomes.data.map((i) => (
            <SummaryRow key={i.id} label={incomeTitle(i)} detail={incomeDetail(i, items)} onPress={() => setEditing(i)} />
          ))}
        </View>
      )}
      {next && <Text style={styles.muted}>{next}</Text>}
      <PrimaryButton label="Новый доход" onPress={() => setEditing("new")} />
      {editing &&
        (named ? (
          <IncomeForm income={income} items={items} nextId={nextOfIncome?.id} nextDate={nextOfIncome?.expected_on} onClose={() => setEditing(null)} />
        ) : (
          <OldIncomeForm income={income} nextId={nextOfIncome?.id} nextDate={nextOfIncome?.expected_on} onClose={() => setEditing(null)} />
        ))}
    </Sheet>
  );
}

type FormProps = { income: ExpectedIncomeDto | null; nextId?: number; nextDate?: string; onClose: () => void };

/** «Удалить» under a form: the limit changes, so it asks first. */
function DeleteIncome({ income, onDone }: { income: ExpectedIncomeDto; onDone: () => void }) {
  const remove = useDeleteIncome();
  const title = incomeTitle(income);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Удалить: ${title}`}
      disabled={remove.isPending}
      style={styles.action}
      onPress={() =>
        askDelete(title, "Лимит будет посчитан без этого дохода.", () =>
          remove.mutate(income.id, { onSuccess: onDone, onError: () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.") }),
        )
      }
    >
      <Text style={styles.actionText}>Удалить</Text>
    </Pressable>
  );
}

function Toggle({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={[styles.text, styles.grow]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: color.data.track, true: color.accent.default }}
        thumbColor={color.fg.default}
      />
    </View>
  );
}

/**
 * The form of a named income (Д3а server): name, amount, how it comes, the account, then the two quiet switches.
 * «Раз в месяц» keeps the window the income had (the owner's ФОП comes 1–5); «Два раза в месяц» is two days, the
 * first stored as a one-day window, as the server expects. The fop tax cannot go with two payments a month.
 */
function IncomeForm({ income, items, nextId, nextDate, onClose }: FormProps & { items: OwnMoneyItemDto[] }) {
  const create = useCreateIncome();
  const patch = usePatchIncome();
  const setDate = useSetIncomeDate();
  const places = incomePlaces(items);
  const [name, setName] = useState(income ? incomeTitle(income) : "");
  const [amount, setAmount] = useState(income ? amountText(income.amount) : "");
  const [currency, setCurrency] = useState(income?.currency ?? "UAH");
  const [schedule, setSchedule] = useState<IncomeSchedule>(income?.schedule ?? "monthly");
  const [from, setFrom] = useState(income ? String(income.window_start_day) : "");
  const [to, setTo] = useState(income ? String(income.window_end_day) : "");
  const [first, setFirst] = useState(income?.schedule === "twice" ? String(income.window_end_day) : "");
  const [second, setSecond] = useState(income?.second_day != null ? String(income.second_day) : "");
  const [account, setAccount] = useState<IncomeAccount | null>(income?.account ?? null);
  const [picking, setPicking] = useState(false);
  const [tax, setTax] = useState(income?.pays_fop_tax ?? false);
  const [crypto, setCrypto] = useState(income?.crypto ?? false);
  const [date, setDateValue] = useState(nextDate ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const twice = schedule === "twice";
  // An account the list no longer shows (an empty one is left out of «Сегодня») stays as it is.
  const accountName = account === null ? null : (places.find((p) => sameAccount(p.account, account))?.name ?? "Другой счёт");

  /** The days the schedule asks for, as the server stores them; null when they do not make sense. */
  const scheduleDays = (): { window_start_day?: number; window_end_day?: number; second_day: number | null } | null => {
    if (schedule === "none") return { second_day: null };
    if (schedule === "monthly") {
      const start = day(from);
      const end = day(to);
      return start === null || end === null || start > end ? null : { window_start_day: start, window_end_day: end, second_day: null };
    }
    const a = day(first);
    const b = day(second);
    return a === null || b === null ? null : { window_start_day: a, window_end_day: a, second_day: b };
  };

  const save = async () => {
    const title = name.trim();
    const minor = parseHryvnias(amount);
    const days = scheduleDays();
    if (!title || minor === null || days === null) {
      setMessage("Проверьте название, сумму и числа.");
      return;
    }
    if (days.second_day !== null && days.second_day <= days.window_end_day!) {
      setMessage("Второй раз должен быть позже первого.");
      return;
    }
    setMessage(null);
    setBusy(true);
    const values = { name: title, amount: minor, currency, schedule, ...days, pays_fop_tax: tax && !twice, crypto, account };
    try {
      if (income) await patch.mutateAsync({ id: income.id, patch: values });
      else await create.mutateAsync(values);
      if (nextId !== undefined && schedule !== "none" && date !== nextDate) await setDate.mutateAsync({ eventId: nextId, date });
      onClose();
    } catch {
      setMessage(SAVE_FAILED);
      setBusy(false);
    }
  };

  return (
    <Sheet title={income ? incomeTitle(income) : "Новый доход"} onClose={onClose}>
      <Text style={styles.label}>Название</Text>
      <Field label="Название" value={name} onChangeText={setName} maxLength={60} />
      <Text style={styles.label}>Сумма</Text>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Field label="Сумма" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </View>
        <CurrencyChoice value={currency} onChange={setCurrency} />
      </View>
      <Text style={styles.label}>Как приходит</Text>
      <View style={styles.chips}>
        {SCHEDULES.map((s) => (
          <Chip key={s.value} role="radio" label={s.label} selected={schedule === s.value} onPress={() => setSchedule(s.value)} />
        ))}
      </View>
      {schedule === "monthly" && (
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.label}>С какого числа</Text>
            <Field label="С какого числа" value={from} onChangeText={setFrom} keyboardType="number-pad" />
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>По какое число</Text>
            <Field label="По какое число" value={to} onChangeText={setTo} keyboardType="number-pad" />
          </View>
        </View>
      )}
      {twice && (
        <View style={styles.row}>
          <View style={styles.half}>
            <Text style={styles.label}>Первый раз</Text>
            <Field label="Первый раз" value={first} onChangeText={setFirst} keyboardType="number-pad" />
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>Второй раз</Text>
            <Field label="Второй раз" value={second} onChangeText={setSecond} keyboardType="number-pad" />
          </View>
        </View>
      )}
      {nextId !== undefined && schedule !== "none" && <DateField label="Следующий доход" value={date} onChange={setDateValue} />}
      <Text style={styles.label}>На какой счёт</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accountName === null ? "На какой счёт: не выбран" : `На какой счёт: ${accountName}`}
        accessibilityState={{ expanded: picking }}
        onPress={() => setPicking((p) => !p)}
        style={styles.picker}
      >
        <Text style={[styles.text, styles.grow]}>{accountName ?? "Не выбран"}</Text>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
      {picking && (
        <View style={styles.chips}>
          {places.map((p) => (
            <Chip
              key={p.account.source === "cash" ? "cash" : `${p.account.source}:${p.account.id}`}
              role="radio"
              label={p.name}
              selected={sameAccount(p.account, account)}
              onPress={() => {
                setAccount(p.account);
                setPicking(false);
              }}
            />
          ))}
        </View>
      )}
      <View style={styles.divider} />
      <Toggle label={TAX} value={tax && !twice} disabled={twice} onChange={setTax} />
      {twice && <Text style={styles.muted}>Налог ФОП платится с дохода, который приходит раз в месяц или без расписания.</Text>}
      <Toggle label={CRYPTO} value={crypto} onChange={setCrypto} />
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label="Сохранить доход" disabled={busy} onPress={() => void save()} />
      {income && <DeleteIncome income={income} onDone={onClose} />}
    </Sheet>
  );
}

/** The form for a server older than Д3а: the old kind, the amount and the month's window; it sends only those. */
function OldIncomeForm({ income, nextId, nextDate, onClose }: FormProps) {
  const create = useCreateIncome();
  const patch = usePatchIncome();
  const setDate = useSetIncomeDate();
  const [source, setSource] = useState<"fop" | "usdc">(income?.source ?? "fop");
  const [amount, setAmount] = useState(income ? amountText(income.amount) : "");
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
      setMessage(SAVE_FAILED);
      setBusy(false);
    }
  };

  return (
    <Sheet title={income ? incomeTitle(income) : "Новый доход"} onClose={onClose}>
      {!income && (
        <Segmented
          testID="income-source"
          options={SOURCE_OPTIONS}
          value={source}
          onChange={(s) => {
            setSource(s);
            setCurrency(s === "usdc" ? "USD" : "UAH");
          }}
        />
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
      {income && <DeleteIncome income={income} onDone={onClose} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: color.surface.inset },
  label: { ...type.caption, color: color.fg.muted },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.caption, color: color.fg.muted },
  arrow: { ...type.title, color: color.fg.subtle },
  row: { flexDirection: "row", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  half: { flex: 1, gap: space.xs },
  grow: { flex: 1 },
  picker: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface.inset,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.surface.overlay },
  switchRow: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  action: { minHeight: touchMin, justifyContent: "center", alignSelf: "center" },
  actionText: { ...type.label, color: color.fg.muted },
});
