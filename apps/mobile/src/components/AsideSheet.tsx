import { Children, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import { Sheet } from "./Sheet";
import { ListRow, ListRows } from "./PlanList";

const { color, space, type } = tokens;

type Props = {
  /** The places in it, as rows. */
  rows: ReactNode;
  /**
   * The places with nothing on them (ЯМ5): under their own quiet header below the others, and a line at the end saying
   * they go back to «Счета». Only a server that lists them here sends them; an older one keeps them in «Счета».
   */
  empty?: ReactNode;
  /** What the last row adds: an account on a newer server, a set-aside balance on an older one. */
  add: { label: string; onPress: () => void };
  onClose: () => void;
  /** Windows opened from its rows: inside its modal, so iOS shows them on top and closing returns here. */
  children?: ReactNode;
};

/**
 * «Отложено» on «План» (variant А): the places kept out of own money, then those with nothing on them under «Сейчас
 * пусто», then a row that adds one more.
 */
export function AsideSheet({ rows, empty, add, onClose, children }: Props) {
  const hasEmpty = Children.toArray(empty).length > 0;
  return (
    <Sheet title="Отложено" subtitle="не входит в свои деньги" onClose={onClose}>
      <ListRows>{rows}</ListRows>
      {hasEmpty ? (
        <>
          <Text style={styles.header}>Сейчас пусто</Text>
          <ListRows>{empty}</ListRows>
        </>
      ) : null}
      <ListRows>
        <ListRow key="add" icon="plus" label={add.label} onPress={add.onPress} />
      </ListRows>
      {hasEmpty ? <Text style={styles.footer}>Пустые счета вернутся в «Счета», когда на них появятся деньги.</Text> : null}
      {children}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // As a section header of «План»: small, upper-case, quiet.
  header: { ...type.caption, color: color.list.secondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: space.sm },
  footer: { ...type.caption, color: color.list.secondary },
});
