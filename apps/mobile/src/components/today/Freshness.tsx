import type { TodayDto } from "@hale/contracts";
import { formatStamp, kyivDate, shortDate } from "../../format";
import { StaleBanner } from "../StaleBanner";

function freshnessLines(data: TodayDto, offlineSince: number | null, now: Date): string[] {
  const lines: string[] = [];
  if (data.date !== kyivDate(now)) {
    lines.push(`Показаны данные за ${shortDate(data.date, kyivDate(now))}, не за сегодня.`);
  }
  if (offlineSince !== null) {
    lines.push(`Нет связи. Показаны данные от ${formatStamp(new Date(offlineSince).toISOString(), now)}.`);
  }
  if (data.syncStale) {
    lines.push(
      data.syncedAt
        ? `Банк обновлялся ${formatStamp(data.syncedAt, now)}. Показаны последние данные.`
        : "Синхронизации с банком ещё не было.",
    );
  }
  return lines;
}

/**
 * The banner above the limit that says the figures are not fresh: another day's data, no connection, a stale bank sync.
 *
 * Contract: `offlineSince` is the time (ms) the shown data was fetched when the last request failed, else null;
 * `now` is the current moment (the screen's test seam). With nothing to say `StaleBanner` draws nothing.
 */
export function Freshness({ data, offlineSince, now }: { data: TodayDto; offlineSince: number | null; now: Date }) {
  return <StaleBanner lines={freshnessLines(data, offlineSince, now)} />;
}
