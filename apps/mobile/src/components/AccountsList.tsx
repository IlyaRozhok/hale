import type { TodayDto } from "@hale/contracts";
import { Line } from "./Line";

type Props = { accounts: TodayDto["accounts"]; usdRate: number };

/** Own money and credit money are separate lines: credit is a limit, not a balance to add up. */
export function AccountLines({ accounts, usdRate }: Props) {
  return (
    <>
      <Line label="Свои" kopecks={accounts.own} usdRate={usdRate} />
      {accounts.fop !== 0 && <Line subtle label="в том числе ФОП" kopecks={accounts.fop} usdRate={usdRate} />}
      {accounts.cash !== 0 && <Line subtle label="в том числе наличные" kopecks={accounts.cash} usdRate={usdRate} />}
      {accounts.binance !== 0 && <Line subtle label="в том числе Binance" kopecks={accounts.binance} usdRate={usdRate} />}
      <Line label="Кредитные" kopecks={accounts.credit} usdRate={usdRate} />
    </>
  );
}
