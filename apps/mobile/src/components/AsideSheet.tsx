import type { ReactNode } from "react";
import { Sheet } from "./Sheet";
import { ListRow, ListRows } from "./PlanList";

type Props = {
  /** The places in it, as rows. */
  rows: ReactNode;
  /** What the last row adds: an account on a newer server, a set-aside balance on an older one. */
  add: { label: string; onPress: () => void };
  onClose: () => void;
  /** Windows opened from its rows: inside its modal, so iOS shows them on top and closing returns here. */
  children?: ReactNode;
};

/**
 * «Отложено» on «План» (variant А): the places kept out of own money and the places with nothing on them, then a row
 * that adds one more.
 */
export function AsideSheet({ rows, add, onClose, children }: Props) {
  return (
    <Sheet title="Отложено" subtitle="не входит в свои деньги" onClose={onClose}>
      <ListRows>
        {rows}
        <ListRow key="add" icon="plus" label={add.label} onPress={add.onPress} />
      </ListRows>
      {children}
    </Sheet>
  );
}
