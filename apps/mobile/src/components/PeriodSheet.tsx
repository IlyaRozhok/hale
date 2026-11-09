import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { tokens } from "@hale/tokens";
import { shiftDate } from "../format";
import { Chip } from "./Chip";
import { DateField } from "./DateField";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { space } = tokens;

export type Period = { from: string; to: string };

type Props = { today: string; value: Period | null; onPick: (p: Period) => void; onClose: () => void };

/** A period for the operations list: today, the last seven days, this month, or from and to on a calendar. */
export function PeriodSheet({ today, value, onPick, onClose }: Props) {
  const [from, setFrom] = useState(value?.from ?? today);
  const [to, setTo] = useState(value?.to ?? today);
  const pick = (p: Period) => {
    onPick(p);
    onClose();
  };
  return (
    <Sheet title="Период" onClose={onClose}>
      <View style={styles.quick}>
        <Chip label="Сегодня" onPress={() => pick({ from: today, to: today })} />
        <Chip label="Неделя" onPress={() => pick({ from: shiftDate(today, -6), to: today })} />
        <Chip label="Месяц" onPress={() => pick({ from: `${today.slice(0, 7)}-01`, to: today })} />
      </View>
      <DateField label="С" value={from} onChange={setFrom} max={to} />
      <DateField label="По" value={to} onChange={setTo} min={from} max={today} />
      <PrimaryButton label="Показать" onPress={() => pick(from <= to ? { from, to } : { from: to, to: from })} />
    </Sheet>
  );
}

const styles = StyleSheet.create({ quick: { flexDirection: "row", flexWrap: "wrap", gap: space.sm } });
