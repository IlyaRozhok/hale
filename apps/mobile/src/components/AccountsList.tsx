import type { TodayDto } from "@hale/contracts";
import { Line } from "./Line";

type Props = { accounts: TodayDto["accounts"]; usdRate: number };

/** Own money and credit money are separate lines: credit is a limit, not a balance to add up. Cash and Binance have their own rows next to these. */
export function AccountLines({ accounts, usdRate }: Props) {
  return (
    <>
      <Line label="Свои" kopecks={accounts.own} usdRate={usdRate} />
      {accounts.fop !== 0 && <Line subtle label="в том числе ФОП" kopecks={accounts.fop} usdRate={usdRate} />}
      <Line label="Кредитные" kopecks={accounts.credit} usdRate={usdRate} />
    </>
  );
}
