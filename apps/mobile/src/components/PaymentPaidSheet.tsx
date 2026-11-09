import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { useCash, useMarkPaid, usePayFromWallet } from "../api/queries";
import { formatMoney, shortDate } from "../format";
import { ErrorText } from "./ErrorText";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, space, type } = tokens;

type Props = { payment: TodayDto["upcoming"][number]; today: string; onClose: () => void };

/** "Оплачено" for a planned payment; in cash from the wallet only when the wallet covers it. */
export function PaymentPaidSheet({ payment, today, onClose }: Props) {
  const cash = useCash();
  const markPaid = useMarkPaid();
  const payFromWallet = usePayFromWallet();
  const [inCash, setInCash] = useState(false);
  const [failed, setFailed] = useState(false);
  const w = cash.data;
  const canOfferCash = w?.started === true && payment.currency === "UAH";
  const covers = canOfferCash && w.balance >= payment.amount;
  const busy = markPaid.isPending || payFromWallet.isPending;
  const due = payment.dueOn < today ? `просрочен с ${shortDate(payment.dueOn)}` : `до ${shortDate(payment.dueOn)}`;

  const save = () => {
    setFailed(false);
    const id = Number(payment.id);
    const done = { onSuccess: onClose, onError: () => setFailed(true) };
    if (inCash && covers) payFromWallet.mutate(id, done);
    else markPaid.mutate(id, done);
  };

  return (
    <Sheet title={payment.name} subtitle={`${formatMoney(payment.amount)} · ${due}`} onClose={onClose}>
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
        {inCash && covers
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
});
