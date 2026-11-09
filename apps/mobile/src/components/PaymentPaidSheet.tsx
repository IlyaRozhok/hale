import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto, TransactionDto } from "@hale/contracts";
import { useCash, useMarkPaid, usePayFromWallet, usePaymentCandidates, usePayWith } from "../api/queries";
import { formatMoney, shortDate } from "../format";
import { ErrorText } from "./ErrorText";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

type Props = { payment: TodayDto["upcoming"][number]; today: string; onClose: () => void };

const spent = (t: TransactionDto) => Math.abs(t.amountUah ?? t.amount);

/**
 * "Оплачено" for a planned payment. The owner may say which operations paid it, several if the sum
 * was put together; otherwise in cash from the wallet (only when the wallet covers it) or just paid.
 */
export function PaymentPaidSheet({ payment, today, onClose }: Props) {
  const id = Number(payment.id);
  const cash = useCash();
  const candidates = usePaymentCandidates(id);
  const markPaid = useMarkPaid();
  const payFromWallet = usePayFromWallet();
  const payWith = usePayWith();
  const [inCash, setInCash] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  const w = cash.data;
  const offered = candidates.data ?? [];
  const picked = offered.filter((t) => chosen.includes(t.id));
  const canOfferCash = w?.started === true && payment.currency === "UAH" && picked.length === 0;
  const covers = canOfferCash && w.balance >= payment.amount;
  const busy = markPaid.isPending || payFromWallet.isPending || payWith.isPending;
  const toggle = (txId: number) => setChosen((c) => (c.includes(txId) ? c.filter((x) => x !== txId) : [...c, txId]));
  const due = payment.dueOn < today ? `просрочен с ${shortDate(payment.dueOn)}` : `до ${shortDate(payment.dueOn)}`;

  const save = () => {
    setFailed(false);
    const done = { onSuccess: onClose, onError: () => setFailed(true) };
    if (picked.length > 0) payWith.mutate({ paymentId: id, transactionIds: picked.map((t) => t.id) }, done);
    else if (inCash && covers) payFromWallet.mutate(id, done);
    else markPaid.mutate(id, done);
  };

  return (
    <Sheet title={payment.name} subtitle={`${formatMoney(payment.amount)} · ${due}`} onClose={onClose}>
      {offered.length > 0 && (
        <View style={styles.stack}>
          <Text style={styles.heading}>Чем оплачено</Text>
          {offered.map((t) => {
            const on = chosen.includes(t.id);
            const name = t.counterName ?? t.description;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="checkbox"
                accessibilityLabel={`${name}, ${shortDate(t.localDate)}, ${formatMoney(spent(t))}`}
                accessibilityState={{ checked: on }}
                onPress={() => toggle(t.id)}
                style={styles.option}
              >
                <View style={[styles.box, on && styles.boxOn]} />
                <Text style={styles.optionText} numberOfLines={1}>{name}</Text>
                <Text style={styles.muted}>{shortDate(t.localDate)}</Text>
                <Text style={styles.amount}>{formatMoney(spent(t))}</Text>
              </Pressable>
            );
          })}
          {picked.length > 0 && (
            <Text style={styles.text}>{`Выбрано ${formatMoney(picked.reduce((s, t) => s + spent(t), 0))} из ${formatMoney(payment.amount)}`}</Text>
          )}
        </View>
      )}
      {canOfferCash && (
        <View style={styles.switchRow}>
          <Text style={styles.text}>Наличными из кошелька</Text>
          <Switch
            accessibilityLabel="Наличными из кошелька"
            value={inCash && covers}
            disabled={!covers}
            onValueChange={setInCash}
            trackColor={{ false: color.data.track, true: color.accent.default }}
            thumbColor={color.fg.default}
          />
        </View>
      )}
      {canOfferCash && !covers && (
        <Text style={styles.muted}>{`В кошельке по записям ${formatMoney(w.balance)}. Если наличные были до начала учёта, просто отметьте оплату.`}</Text>
      )}
      <Text style={styles.muted}>
        {picked.length > 0
          ? "Платёж закроется, выбранные операции станут им и не потратят лимит."
          : inCash && covers
            ? `Наличные уменьшатся на ${formatMoney(payment.amount)}, лимит не изменится.`
            : "Платёж закроется, деньги под него больше не откладываются."}
      </Text>
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      <PrimaryButton label="Оплачено" disabled={busy} onPress={save} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  text: { ...type.body, color: color.fg.default, flexShrink: 1 },
  muted: { ...type.body, color: color.fg.muted },
  stack: { gap: space.sm },
  heading: { ...type.label, color: color.fg.muted },
  option: { minHeight: touchMin, flexDirection: "row", alignItems: "center", gap: space.md },
  box: { width: space.lg, height: space.lg, borderRadius: radius.sm, borderWidth: 2, borderColor: color.fg.muted },
  boxOn: { backgroundColor: color.accent.default, borderColor: color.accent.default },
  optionText: { ...type.body, color: color.fg.default, flex: 1 },
  amount: { ...type.body, color: color.fg.default, fontVariant: ["tabular-nums"] },
});
