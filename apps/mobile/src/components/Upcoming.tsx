import type { TodayDto } from "@tablo/contracts";
import { dueLabel } from "../format";
import { Glass } from "./Glass";
import { Line } from "./Line";

type Props = { items: TodayDto["upcoming"]; today: string; usdRate: number };

/** Payments ahead; amounts arrive in hryvnias already. */
export function Upcoming({ items, today, usdRate }: Props) {
  if (items.length === 0) return null;
  return (
    <Glass>
      {items.map((p) => (
        <Line key={p.id} label={p.name} note={dueLabel(p.dueOn, today)} kopecks={p.amount} usdRate={usdRate} />
      ))}
    </Glass>
  );
}
