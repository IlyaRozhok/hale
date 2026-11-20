import { useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { ManualBalanceInput, OwnMoneyItemDto } from "@hale/contracts";
import { useCreateAccount, useDeleteManualBalance, usePatchAccount, usePatchManualBalance } from "../api/queries";
import { parseBalance } from "../format";
import { balanceFieldLabel, NEW_ACCOUNT_CURRENCIES } from "../labels";
import { accountPatchOf } from "../ownMoney";
import { Chip } from "./Chip";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, touchMin, type } = tokens;

const SAVE_FAILED = "Не удалось сохранить. Попробуйте ещё раз.";
const CHECK_INPUT = "Проверьте название и остаток.";

/** Minor units as the text a person would type: 75000 -> "750", 75050 -> "750.50". */
function minorText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** «Входит в свои деньги» with its note: a switched-off account's purchases still count in the limit. */
function OwnSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.own}>
      <View style={styles.switchRow}>
        <Text style={styles.text}>Входит в свои деньги</Text>
        <Switch
          accessibilityLabel="Входит в свои деньги"
          value={value}
          onValueChange={onChange}
          trackColor={{ false: color.data.track, true: color.accent.default }}
          thumbColor={color.fg.default}
        />
      </View>
      <Text style={styles.muted}>Покупки с этого счёта всё равно считаются в лимите.</Text>
    </View>
  );
}

/**
 * The window of one place money lies (Д2б, variant А), opened from its row in «Деньги» or «Отложено». A bank account:
 * its name, its balance as monobank gives it, and whether it counts as own money. A balance kept by hand: its name, its
 * balance in its own currency, the same switch, and a way to delete it. `amount` is the balance as the row shows it.
 */
export function AccountSheet({ item, amount, onClose }: { item: OwnMoneyItemDto; amount: string; onClose: () => void }) {
  return item.source === "manual" ? <ManualAccount item={item} onClose={onClose} /> : <BankAccount item={item} amount={amount} onClose={onClose} />;
}

function BankAccount({ item, amount, onClose }: { item: OwnMoneyItemDto; amount: string; onClose: () => void }) {
  const patch = usePatchAccount();
  const [name, setName] = useState(item.name);
  const [own, setOwn] = useState(item.countsAsOwn ?? true);
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const change = accountPatchOf(item, name, own);
    if (change === null || item.id === undefined) {
      onClose();
      return;
    }
    setMessage(null);
    patch.mutate({ id: item.id, patch: change }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  return (
    <Sheet title={item.name} subtitle="monobank" onClose={onClose}>
      <Text style={styles.label}>Название</Text>
      <Field label="Название" value={name} onChangeText={setName} maxLength={100} />
      <View style={styles.balance}>
        <View style={styles.grow}>
          <Text style={styles.text}>Остаток</Text>
          <Text style={styles.muted}>приходит из monobank</Text>
        </View>
        <Text style={styles.amount}>{amount}</Text>
      </View>
      <OwnSwitch value={own} onChange={setOwn} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить" onPress={save} disabled={patch.isPending} />
    </Sheet>
  );
}

function ManualAccount({ item, onClose }: { item: OwnMoneyItemDto; onClose: () => void }) {
  const patch = usePatchManualBalance();
  const remove = useDeleteManualBalance();
  const currency = item.currency ?? "UAH";
  const field = balanceFieldLabel(currency);
  const [name, setName] = useState(item.name);
  const [balance, setBalance] = useState(item.amount === undefined ? "" : minorText(item.amount));
  const [own, setOwn] = useState(item.countsAsOwn ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const id = item.id!;

  const save = () => {
    const title = name.trim();
    const minor = parseBalance(balance);
    if (!title || minor === null) {
      setMessage(CHECK_INPUT);
      return;
    }
    setMessage(null);
    patch.mutate({ id, patch: { name: title, amount: minor, counts_as_own: own } }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  const confirmRemove = () =>
    Alert.alert("Удалить счёт?", `${item.name} уйдёт из плана.`, [
      { text: "Оставить", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          remove.mutate(id, { onSuccess: onClose, onError: () => Alert.alert("Не удалось удалить", "Проверьте связь и попробуйте ещё раз.") }),
      },
    ]);

  return (
    <Sheet title={item.name} onClose={onClose}>
      <Text style={styles.label}>Название</Text>
      <Field label="Название" value={name} onChangeText={setName} maxLength={100} />
      <Text style={styles.label}>{field}</Text>
      <Field label={field} keyboardType="decimal-pad" value={balance} onChangeText={setBalance} />
      <Text style={styles.muted}>Остаток вы правите сами, когда захотите.</Text>
      <OwnSwitch value={own} onChange={setOwn} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить" onPress={save} disabled={patch.isPending} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Удалить: ${item.name}`}
        onPress={confirmRemove}
        disabled={remove.isPending}
        style={styles.action}
      >
        <Text style={styles.actionText}>Удалить</Text>
      </Pressable>
    </Sheet>
  );
}

/**
 * «Новый счёт» (Д2б, variant А): a deposit, another bank's card, an envelope — a name, a currency, a balance the person
 * keeps by hand. It is set aside unless switched on.
 */
export function NewAccountSheet({ onClose }: { onClose: () => void }) {
  const create = useCreateAccount();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<ManualBalanceInput["currency"]>("UAH");
  const [balance, setBalance] = useState("");
  const [own, setOwn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const title = name.trim();
    const minor = parseBalance(balance);
    if (!title || minor === null) {
      setMessage(CHECK_INPUT);
      return;
    }
    setMessage(null);
    create.mutate({ name: title, amount: minor, currency, countsAsOwn: own }, { onSuccess: onClose, onError: () => setMessage(SAVE_FAILED) });
  };

  return (
    <Sheet title="Новый счёт" onClose={onClose}>
      <Text style={styles.label}>Название</Text>
      <Field label="Название" value={name} onChangeText={setName} maxLength={100} />
      <Text style={styles.label}>Валюта</Text>
      <View style={styles.chips}>
        {NEW_ACCOUNT_CURRENCIES.map((c) => (
          <Chip key={c.code} role="radio" label={c.label} selected={currency === c.code} onPress={() => setCurrency(c.code)} />
        ))}
      </View>
      <Text style={styles.label}>Остаток</Text>
      <Field label="Остаток" keyboardType="decimal-pad" value={balance} onChangeText={setBalance} />
      <Text style={styles.muted}>Остаток вы правите сами, когда захотите.</Text>
      <OwnSwitch value={own} onChange={setOwn} />
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Добавить счёт" onPress={add} disabled={create.isPending} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { ...type.caption, color: color.fg.muted },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.caption, color: color.fg.muted },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
  grow: { flex: 1 },
  balance: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  own: { gap: space.xs },
  switchRow: { minHeight: touchMin, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  chips: { flexDirection: "row", gap: space.sm },
  action: { minHeight: touchMin, justifyContent: "center", alignSelf: "center" },
  actionText: { ...type.label, color: color.fg.muted },
});
