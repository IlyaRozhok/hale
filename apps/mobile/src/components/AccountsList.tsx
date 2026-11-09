import { StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import type { TodayDto } from "@hale/contracts";
import { Glass } from "./Glass";
import { Line } from "./Line";

const { color, space, type } = tokens;

type Props = { title: string; accounts: TodayDto["accounts"]; usdRate: number };

/** Own money and credit money are separate lines: credit is a limit, not a balance to add up. */
export function AccountsList({ title, accounts, usdRate }: Props) {
  return (
    <Glass style={styles.stack}>
      <Text style={styles.heading}>{title}</Text>
      <Line label="Свои" kopecks={accounts.own} usdRate={usdRate} />
      {accounts.fop !== 0 && <Line subtle label="в том числе ФОП" kopecks={accounts.fop} usdRate={usdRate} />}
      {accounts.cash !== 0 && <Line subtle label="в том числе наличные" kopecks={accounts.cash} usdRate={usdRate} />}
      {accounts.binance !== 0 && <Line subtle label="в том числе Binance" kopecks={accounts.binance} usdRate={usdRate} />}
      <Line label="Кредитные" kopecks={accounts.credit} usdRate={usdRate} />
    </Glass>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xs },
  heading: { ...type.title, color: color.fg.default },
});
