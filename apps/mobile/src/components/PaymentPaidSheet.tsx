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
 * How far, in kopecks, the operations may fall short and still close the payment: the server's
 * PAYMENT_COVER_TOLERANCE (apps/api/src/domain/payment-cover.ts, task Б9). Keep the two equal.
 */
const COVER_TOLERANCE = 2_000;

/**
 * "Оплачено" for a planned payment. The owner may say which operations paid it, several if the sum
 * was put together; otherwise in cash from the wallet (only when the wallet covers it) or just paid.
 * Operations that do not cover it leave it open (task Б9): the sheet says how much is missing, and a
 * partly paid payment shows what is paid. Its rest can be paid in cash from the wallet (task Б54): the
 * server takes only the rest then. An older server sends no `paid`, and closes the payment on any
 * operation: then none of this is shown.
 * `payment.amount` is in hryvnias whatever `currency` says: "Сегодня" converts a foreign payment
 * before sending it, so every amount here takes the hryvnia sign.
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
  const pickedSum = picked.reduce((s, t) => s + spent(t), 0);
  const knowsParts = payment.paid !== undefined;
  const alreadyPaid = payment.paid ?? 0;
  const missing = payment.amount - alreadyPaid - pickedSum;
  const staysOpen = knowsParts && picked.length > 0 && missing > COVER_TOLERANCE;
  // In cash goes what is not paid yet: the whole amount, or the rest of a partly paid payment.
  const cashDue = payment.amount - alreadyPaid;
  const canOfferCash = w?.started === true && payment.currency === "UAH" && picked.length === 0 && cashDue > 0;
  const covers = canOfferCash && w.balance >= cashDue;
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
      {alreadyPaid > 0 && <Text style={styles.muted}>{`Уже оплачено ${formatMoney(alreadyPaid)} из ${formatMoney(payment.amount)}`}</Text>}
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
            <Text style={styles.text}>{`Выбрано ${formatMoney(pickedSum)} из ${formatMoney(payment.amount)}`}</Text>
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
        <Text style={styles.muted}>
          {alreadyPaid > 0
            ? `В кошельке по записям ${formatMoney(w.balance)}, остаток платежа — ${formatMoney(cashDue)}. Если наличные были до начала учёта, просто отметьте оплату.`
            : `В кошельке по записям ${formatMoney(w.balance)}. Если наличные были до начала учёта, просто отметьте оплату.`}
        </Text>
      )}
      <Text style={styles.muted}>
        {staysOpen
          ? `Платёж останется открытым: не хватает ${formatMoney(missing)}. Остальное можно отметить потом.`
          : picked.length > 0
          ? "Платёж закроется, выбранные операции станут им и не потратят лимит."
          : inCash && covers
            ? alreadyPaid > 0
              ? `Наличные уменьшатся на ${formatMoney(cashDue)} — остаток платежа. Лимит не изменится.`
              : `Наличные уменьшатся на ${formatMoney(payment.amount)}, лимит не изменится.`
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
