import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoanInput, RecipientLabelName, ScheduledPaymentInput, SettingsDto, SettingsPatch, TodayDto, TransactionPatch } from "@tablo/contracts";
import { useApi } from "./context";

export const TODAY_KEY = ["today"] as const;
export const TRANSACTIONS_KEY = ["transactions"] as const;
export const SETTINGS_KEY = ["settings"] as const;
export const PAYMENTS_KEY = ["payments"] as const;
export const CAP_PREVIEW_KEY = ["cap-preview"] as const;
export const MANUAL_BALANCES_KEY = ["manual-balances"] as const;
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
  return { data: query.data, failed: query.isError, retry: () => void query.refetch() };
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
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: MANUAL_BALANCES_KEY })]),
  });
}

/** "Yes, this credit came from Binance": the balance drops and the row becomes an own transfer. */
export function useMatchUsdc() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, transactionId }: { eventId: number; transactionId: number }) => api.matchUsdc(eventId, transactionId),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }),
        client.invalidateQueries({ queryKey: MANUAL_BALANCES_KEY }),
      ]),
  });
}

export function useDismissUsdcMatch() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: number) => api.dismissUsdcMatch(transactionId),
    onSuccess: () => client.invalidateQueries({ queryKey: TODAY_KEY }),
  });
}

export function useManualBalances() {
  const api = useApi();
  return useQuery({ queryKey: MANUAL_BALANCES_KEY, queryFn: () => api.manualBalances() });
}

/** Corrects the Binance balance, creating the row the first time. */
export function useSaveBinanceBalance() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount }: { id: number | null; amount: number }) =>
      id === null ? api.createManualBalance({ name: "Binance", amount, currency: "USD" }) : api.patchManualBalance(id, amount),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: MANUAL_BALANCES_KEY }),
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY }),
      ]),
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

// --- activity -----------------------------------------------------------------

/** Pages of operations by cursor, optionally only the ones waiting for an answer. */
export function useTransactions(needsLabel: boolean) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...TRANSACTIONS_KEY, { needsLabel }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.transactions({ cursor: pageParam, needsLabel: needsLabel ? true : undefined }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEditTransaction() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Pick<TransactionPatch, "type" | "category" | "applyToSimilar"> }) =>
      api.editTransaction(id, patch),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY })]),
  });
}

export function useLabelRecipient() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ counterKey, label }: { counterKey: string; label: RecipientLabelName }) => api.labelRecipient(counterKey, label),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY })]),
  });
}

// --- settings -----------------------------------------------------------------

export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.settings() });
}

/**
 * Saves a settings change. The screens change at once (Today's limit visual, the settings values)
 * and go back to what they were if the server refuses.
 */
export function useSaveSettings() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onMutate: async (patch) => {
      await Promise.all([client.cancelQueries({ queryKey: TODAY_KEY }), client.cancelQueries({ queryKey: SETTINGS_KEY })]);
      const settings = client.getQueryData<SettingsDto>(SETTINGS_KEY);
      const today = client.getQueryData<TodayDto>(TODAY_KEY);
      if (settings) client.setQueryData<SettingsDto>(SETTINGS_KEY, { ...settings, ...patch });
      if (today && patch.limit_visual) client.setQueryData<TodayDto>(TODAY_KEY, { ...today, limitVisual: patch.limit_visual });
      return { settings, today };
    },
    onError: (_error, _patch, previous) => {
      if (previous?.settings) client.setQueryData(SETTINGS_KEY, previous.settings);
      if (previous?.today) client.setQueryData(TODAY_KEY, previous.today);
    },
    onSuccess: (saved) => client.setQueryData(SETTINGS_KEY, saved),
    onSettled: () => client.invalidateQueries({ queryKey: TODAY_KEY }),
  });
}

/** What a lifestyle cap means, from the server, requested only after the value stops changing. */
export function useCapPreview(cap: number | null) {
  const api = useApi();
  const [settled, setSettled] = useState<number | null>(cap);
  useEffect(() => {
    if (cap === null || cap === settled) return;
    const t = setTimeout(() => setSettled(cap), PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [cap, settled]);
  const query = useQuery({
    queryKey: [...CAP_PREVIEW_KEY, settled],
    queryFn: () => api.previewSettings(settled!),
    enabled: settled !== null,
    placeholderData: (previous) => previous,
  });
  return { data: query.data, stale: query.isPlaceholderData || (cap !== null && cap !== settled), failed: query.isError };
}

export function useTaxPayments() {
  const api = useApi();
  return useQuery({ queryKey: PAYMENTS_KEY, queryFn: () => api.payments(), select: (all) => all.filter((p) => p.kind === "tax") });
}

export function useCreatePayment() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduledPaymentInput) => api.createPayment(input),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PAYMENTS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY })]),
  });
}

export function useMarkPaid() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.markPaid(id),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PAYMENTS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY })]),
  });
}

export function useCreateLoan() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoanInput) => api.createLoan(input),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY })]),
  });
}
