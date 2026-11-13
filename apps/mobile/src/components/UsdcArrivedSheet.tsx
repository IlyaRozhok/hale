import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { useConfirmIncome } from "../api/queries";
import { formatDollars, parseBalance } from "../format";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, type } = tokens;

/** Cents as the text a person would type: 270000 -> "2700", 260050 -> "2600.50". */
function dollarsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

type Props = {
  eventId: number;
  /** The expected amount in cents: filled in, so the usual case is just «Сохранить». */
  expectedAmount: number;
  onClose: () => void;
  /** The income is confirmed with the amount that arrived; the card can go. */
  onSaved: () => void;
};

/**
 * «Пришло другое»: how much actually came to Binance. The expected amount is filled in and can be
 * corrected; Binance gets what was entered, not what was expected.
 */
export function UsdcArrivedSheet({ eventId, expectedAmount, onClose, onSaved }: Props) {
  const confirm = useConfirmIncome();
  const [amount, setAmount] = useState(dollarsText(expectedAmount));
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    const cents = parseBalance(amount);
    if (cents === null || cents <= 0) {
      setMessage("Проверьте сумму.");
      return;
    }
    setMessage(null);
    confirm.mutate(
      { eventId, amount: cents },
      {
        onSuccess: () => {
          onSaved();
          onClose();
        },
        onError: () => setMessage("Не удалось сохранить. Попробуйте ещё раз."),
      },
    );
  };

  return (
    <Sheet title="Сколько пришло на Binance?" onClose={onClose}>
      <Field label="Пришло, $" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus />
      <Text style={styles.hint}>{`Ожидали ${formatDollars(expectedAmount)}. Если пришло другое — поправьте.`}</Text>
      {message ? <ErrorText>{message}</ErrorText> : null}
      <PrimaryButton label="Сохранить" onPress={save} disabled={confirm.isPending} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { ...type.caption, color: color.fg.muted },
});
