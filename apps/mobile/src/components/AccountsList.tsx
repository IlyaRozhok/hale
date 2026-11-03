import type { TodayDto } from "@hale/contracts";
import { Glass } from "./Glass";
import { Line } from "./Line";

type Props = { accounts: TodayDto["accounts"]; usdRate: number };

/** Own money and credit money are separate lines: credit is a limit, not a balance to add up. */
export function AccountsList({ accounts, usdRate }: Props) {
  return (
    <Glass>
      <Line label="Свои" kopecks={accounts.own} usdRate={usdRate} />
      {accounts.fop !== 0 && <Line subtle label="в том числе ФОП" kopecks={accounts.fop} usdRate={usdRate} />}
      {accounts.binance !== 0 && <Line subtle label="в том числе Binance" kopecks={accounts.binance} usdRate={usdRate} />}
      <Line label="Кредитные" kopecks={accounts.credit} usdRate={usdRate} />
    </Glass>
  );
}
