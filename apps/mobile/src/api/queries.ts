import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TodayDto } from "@tablo/contracts";
import { useApi } from "./context";

export const TODAY_KEY = ["today"] as const;
/** Debounce between the last slider move and the preview request. */
export const PREVIEW_DELAY_MS = 300;

export function useToday() {
  const api = useApi();
  return useQuery({ queryKey: TODAY_KEY, queryFn: () => api.today() });
}

/** Preview for a slider value, requested only after the value has stopped changing. */
export function useBridgePreview(value: number | null) {
  const api = useApi();
  const [settled, setSettled] = useState<number | null>(null);
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setSettled(value), PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [value]);
  const query = useQuery({
    queryKey: ["bridge-preview", settled],
    queryFn: () => api.previewBridge(settled!),
    enabled: settled !== null,
    placeholderData: (previous) => previous,
  });
  return query.data;
}

export function useChooseBridge() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dailyAmount: number) => api.chooseBridge(dailyAmount),
    onSuccess: (today: TodayDto) => client.setQueryData(TODAY_KEY, today),
  });
}

export function useConfirmIncome() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => api.confirmIncome(eventId),
    onSuccess: () => client.invalidateQueries({ queryKey: TODAY_KEY }),
  });
}

export function useSetIncomeDate() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, date }: { eventId: number; date: string }) => api.setIncomeDate(eventId, date),
    onSuccess: () => client.invalidateQueries({ queryKey: TODAY_KEY }),
  });
}
