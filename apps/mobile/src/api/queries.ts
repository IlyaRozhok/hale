import { useEffect, useState } from "react";
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CategoryDto, CategoryInput, CategoryPatch } from "@hale/contracts";
import type { CategoryList } from "../labels";
import type { CashOperationInput, CashOperationPatch, CashStartInput, ExpectedIncomeInput, ExpectedIncomePatch, InstallmentInput, InstallmentPatch, LoanInput, LoanPatch, LoanRepayInput, RecipientLabelName, RecurringInput, RecurringPatch, ScheduledPaymentInput, ScheduledPaymentPatch, SettingsDto, SettingsPatch, TodayDto, TransactionPatch } from "@hale/contracts";
import type { CashCardAnswer, CashDepositAnswerName, GoalInput, GoalPatch, TxTypeDto } from "@hale/contracts";
import type { TransactionsFilter } from "./client";
import { useApi } from "./context";

export const TODAY_KEY = ["today"] as const;
export const GOALS_KEY = ["goals"] as const;
export const TRANSACTIONS_KEY = ["transactions"] as const;
export const SETTINGS_KEY = ["settings"] as const;
export const PAYMENTS_KEY = ["payments"] as const;
export const CAP_PREVIEW_KEY = ["cap-preview"] as const;
export const MANUAL_BALANCES_KEY = ["manual-balances"] as const;
export const LOANS_KEY = ["loans"] as const;
export const CALENDAR_KEY = ["calendar"] as const;
export const RECIPIENTS_KEY = ["recipients"] as const;
export const EXPECTED_INCOMES_KEY = ["expected-incomes"] as const;
export const INCOME_EVENTS_KEY = ["income-events"] as const;
export const RECURRING_KEY = ["recurring"] as const;
export const CASH_KEY = ["cash"] as const;
export const LEDGER_CHECK_KEY = ["ledger-check"] as const;
/** «Итоги» of a month (task В2): spending by category, so whatever moves a day's spending refreshes it too. */
export const INSIGHTS_KEY = ["insights"] as const;
/** Debounce between the last slider move and the preview request. */
export const PREVIEW_DELAY_MS = 300;

export function useToday() {
  const api = useApi();
  return useQuery({ queryKey: TODAY_KEY, queryFn: () => api.today() });
}

/** A month's «Итоги»; without a month the current one, as the server counts it. Null from an older server. */
export function useInsights(month?: string) {
  const api = useApi();
  return useQuery({ queryKey: [...INSIGHTS_KEY, month ?? "current"], queryFn: () => api.insights(month) });
}

export function useCalendar(month: string, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: [...CALENDAR_KEY, month], queryFn: () => api.calendar(month), enabled });
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

export function useCancelBridge() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelBridge(),
    onSuccess: (today: TodayDto) => client.setQueryData(TODAY_KEY, today),
  });
}

export function useConfirmIncome() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    // Without `amount` the call carries no body: «Да, $2,700» works against an older server.
    mutationFn: ({ eventId, amount }: { eventId: number; amount?: number }) =>
      amount === undefined ? api.confirmIncome(eventId) : api.confirmIncome(eventId, amount),
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
  return useManualBalanceMutation(({ id, amount }: { id: number | null; amount: number }) =>
    id === null ? api.createManualBalance({ name: "Binance", amount, currency: "USD" }) : api.patchManualBalance(id, { amount }),
  );
}

/** Changes to the balances kept by hand show in the plan and, for those counted as own money, on Today. */
function useManualBalanceMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: MANUAL_BALANCES_KEY }),
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY }),
      ]),
  });
}

/** Money set aside (a coin, a deposit): kept in dollars by hand, outside own money and the limit. */
export function useCreateSetAside() {
  const api = useApi();
  return useManualBalanceMutation(({ name, amount }: { name: string; amount: number }) =>
    api.createManualBalance({ name, amount, currency: "USD", counts_as_own: false }),
  );
}

export function usePatchManualBalance() {
  const api = useApi();
  return useManualBalanceMutation(({ id, patch }: { id: number; patch: { name?: string; amount?: number } }) => api.patchManualBalance(id, patch));
}

export function useDeleteManualBalance() {
  const api = useApi();
  return useManualBalanceMutation((id: number) => api.deleteManualBalance(id));
}

export function useSetIncomeDate() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, date }: { eventId: number; date: string }) => api.setIncomeDate(eventId, date),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: INCOME_EVENTS_KEY })]),
  });
}

// --- activity -----------------------------------------------------------------

/** Pages of operations by cursor, optionally only the ones waiting for an answer. */
export function useTransactions(filter: TransactionsFilter) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: [...TRANSACTIONS_KEY, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.transactions({ cursor: pageParam, ...filter }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEditTransaction() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Pick<TransactionPatch, "type" | "category" | "applyToSimilar"> }) =>
      api.editTransaction(id, patch),
    // A new type undoes an answer about where cash came from (Б21): the wallet and Binance may change too.
    onSuccess: () =>
      Promise.all([TRANSACTIONS_KEY, TODAY_KEY, CASH_KEY, MANUAL_BALANCES_KEY, INSIGHTS_KEY].map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

export function useRecipient(counterKey: string) {
  const api = useApi();
  return useQuery({ queryKey: [...RECIPIENTS_KEY, counterKey], queryFn: () => api.recipient(counterKey) });
}

export function useLabelRecipient() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ counterKey, label }: { counterKey: string; label: RecipientLabelName }) => api.labelRecipient(counterKey, label),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }),
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: RECIPIENTS_KEY }),
        client.invalidateQueries({ queryKey: INSIGHTS_KEY }),
      ]),
  });
}

// --- settings -----------------------------------------------------------------

export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.settings() });
}

/** The latest ledger check (task Б11), for one line in Settings; null when there is nothing to show. */
export function useLedgerCheck() {
  const api = useApi();
  return useQuery({ queryKey: LEDGER_CHECK_KEY, queryFn: () => api.ledgerCheck() });
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

/** A change to the plan shows on its lists, on Today and in what the limit preview leaves. */
function usePlanMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all(
        [TODAY_KEY, PAYMENTS_KEY, RECURRING_KEY, EXPECTED_INCOMES_KEY, INCOME_EVENTS_KEY, CAP_PREVIEW_KEY].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

export function usePayments() {
  const api = useApi();
  return useQuery({ queryKey: PAYMENTS_KEY, queryFn: () => api.payments() });
}

export function useRecurring() {
  const api = useApi();
  return useQuery({ queryKey: RECURRING_KEY, queryFn: () => api.recurring() });
}

export function useExpectedIncomes() {
  const api = useApi();
  return useQuery({ queryKey: EXPECTED_INCOMES_KEY, queryFn: () => api.expectedIncomes() });
}

export function useIncomeEvents() {
  const api = useApi();
  return useQuery({ queryKey: INCOME_EVENTS_KEY, queryFn: () => api.incomeEvents() });
}

export function useCreateIncome() {
  const api = useApi();
  return usePlanMutation((input: ExpectedIncomeInput) => api.createExpectedIncome(input));
}

export function usePatchIncome() {
  const api = useApi();
  return usePlanMutation(({ id, patch }: { id: number; patch: ExpectedIncomePatch }) => api.patchExpectedIncome(id, patch));
}

export function useDeleteIncome() {
  const api = useApi();
  return usePlanMutation((id: number) => api.deleteExpectedIncome(id));
}

export function useCreateRecurring() {
  const api = useApi();
  return usePlanMutation((input: RecurringInput) => api.createRecurring(input));
}

export function usePatchRecurring() {
  const api = useApi();
  return usePlanMutation(({ id, patch }: { id: number; patch: RecurringPatch }) => api.patchRecurring(id, patch));
}

export function useDeleteRecurring() {
  const api = useApi();
  return usePlanMutation((id: number) => api.deleteRecurring(id));
}

export function usePatchPayment() {
  const api = useApi();
  return usePlanMutation(({ id, patch }: { id: number; patch: ScheduledPaymentPatch }) => api.patchPayment(id, patch));
}

export function useDeletePayment() {
  const api = useApi();
  return usePlanMutation((id: number) => api.deletePayment(id));
}

export function useCreateInstallment() {
  const api = useApi();
  return usePlanMutation((input: InstallmentInput) => api.createInstallment(input));
}

export function usePatchInstallment() {
  const api = useApi();
  return usePlanMutation(({ name, patch }: { name: string; patch: InstallmentPatch }) => api.patchInstallment(name, patch));
}

export function useDeleteInstallment() {
  const api = useApi();
  return usePlanMutation((name: string) => api.deleteInstallment(name));
}

export function useCreatePayment() {
  const api = useApi();
  return usePlanMutation((input: ScheduledPaymentInput) => api.createPayment(input));
}

export function useMarkPaid() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.markPaid(id),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PAYMENTS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY }), client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY })]),
  });
}

export function useLoanHistory() {
  const api = useApi();
  return useQuery({ queryKey: LOANS_KEY, queryFn: () => api.loanHistory() });
}

/** A loan change shows on Today, in the loan history and in what the limit preview leaves. */
function useLoanMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: LOANS_KEY }),
        client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY }),
      ]),
  });
}

export function useCreateLoan() {
  const api = useApi();
  return useLoanMutation((input: LoanInput) => api.createLoan(input));
}

export function useDeleteLoan() {
  const api = useApi();
  return useLoanMutation((id: number) => api.deleteLoan(id));
}

export function useRepayOldLoans() {
  const api = useApi();
  return useLoanMutation<void>(() => api.repayOldLoans());
}

export function useRepayLoan() {
  const api = useApi();
  return useLoanMutation(({ id, input }: { id: number; input: LoanRepayInput }) => api.repayLoan(id, input));
}

/** «Вернуть до» set or cleared (Б7): the limit moves with it. */
export function usePatchLoan() {
  const api = useApi();
  return useLoanMutation(({ id, input }: { id: number; input: LoanPatch }) => api.patchLoan(id, input));
}

export function useGoals() {
  const api = useApi();
  return useQuery({ queryKey: GOALS_KEY, queryFn: () => api.goals() });
}

/** Goal changes show on the list and on Today's cards. */
function useGoalMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: GOALS_KEY }), client.invalidateQueries({ queryKey: TODAY_KEY })]),
  });
}

export function useCreateGoal() {
  const api = useApi();
  return useGoalMutation((input: GoalInput) => api.createGoal(input));
}

export function usePatchGoal() {
  const api = useApi();
  return useGoalMutation(({ id, patch }: { id: number; patch: GoalPatch }) => api.patchGoal(id, patch));
}

export function useDeleteGoal() {
  const api = useApi();
  return useGoalMutation((id: number) => api.deleteGoal(id));
}

// --- cash wallet ---------------------------------------------------------------------
export function useCash() {
  const api = useApi();
  return useQuery({ queryKey: CASH_KEY, queryFn: () => api.cash() });
}

/** Cash moves the wallet, the day's spending and the list; an exchange of USDC for cash moves Binance too (Б22). */
function useCashMutation<V>(mutationFn: (vars: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: CASH_KEY }),
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }),
        client.invalidateQueries({ queryKey: CALENDAR_KEY }),
        client.invalidateQueries({ queryKey: INSIGHTS_KEY }),
        client.invalidateQueries({ queryKey: MANUAL_BALANCES_KEY }),
      ]),
  });
}

export function useStartCash() {
  const api = useApi();
  return useCashMutation((input: CashStartInput) => api.startCash(input));
}

export function useAddCashOperation() {
  const api = useApi();
  return useCashMutation((input: CashOperationInput) => api.addCashOperation(input));
}

export function usePatchCashOperation() {
  const api = useApi();
  return useCashMutation(({ id, patch }: { id: number; patch: CashOperationPatch }) => api.patchCashOperation(id, patch));
}

export function useDeleteCashOperation() {
  const api = useApi();
  return useCashMutation((id: number) => api.deleteCashOperation(id));
}

export function useCountCash() {
  const api = useApi();
  return useCashMutation((amount: number) => api.countCash(amount));
}

export function useDepositFromWallet() {
  const api = useApi();
  return useCashMutation((transactionId: number) => api.depositFromWallet(transactionId));
}

/** A new answer to «Откуда наличные?»: the wallet, Binance, the income and the day's limit may all change. */
export function useChangeDepositAnswer() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: number; answer: CashDepositAnswerName }) => api.changeDepositAnswer(id, answer),
    onSuccess: () =>
      Promise.all(
        [CASH_KEY, TODAY_KEY, TRANSACTIONS_KEY, MANUAL_BALANCES_KEY, INCOME_EVENTS_KEY, CALENDAR_KEY, INSIGHTS_KEY, CAP_PREVIEW_KEY].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** A planned payment paid in cash: the payment closes and the wallet goes down. */
export function usePayFromWallet() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: number) => api.payFromWallet(paymentId),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: CASH_KEY }),
        client.invalidateQueries({ queryKey: TODAY_KEY }),
        client.invalidateQueries({ queryKey: PAYMENTS_KEY }),
        client.invalidateQueries({ queryKey: TRANSACTIONS_KEY }),
        client.invalidateQueries({ queryKey: CAP_PREVIEW_KEY }),
      ]),
  });
}

// --- paying with operations, the card at another bank, rules -----------------------------
export function usePaymentCandidates(paymentId: number) {
  const api = useApi();
  return useQuery({ queryKey: [...PAYMENTS_KEY, paymentId, "candidates"], queryFn: () => api.paymentCandidates(paymentId) });
}

/** The chosen operations become the payment: the day's spending, the list and the wallet change. */
export function usePayWith() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, transactionIds }: { paymentId: number; transactionIds: number[] }) => api.payWith(paymentId, transactionIds),
    onSuccess: () =>
      Promise.all(
        [CASH_KEY, TODAY_KEY, PAYMENTS_KEY, TRANSACTIONS_KEY, CALENDAR_KEY, INSIGHTS_KEY, CAP_PREVIEW_KEY].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

/** «Это оплата?» answered no: the pair is not asked again; nothing about money changes. */
export function useDismissPaymentMatch() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, transactionId }: { paymentId: number; transactionId: number }) => api.dismissPaymentMatch(paymentId, transactionId),
    onSuccess: () => client.invalidateQueries({ queryKey: TODAY_KEY }),
  });
}

export function useAnswerCashCard() {
  const api = useApi();
  return useCashMutation(({ id, answer }: { id: number; answer: CashCardAnswer }) => api.answerCashCard(id, answer));
}

export function useSetCardCash() {
  const api = useApi();
  return useCashMutation(({ id, amount }: { id: number; amount: number }) => api.setCardCash(id, amount));
}

export const RULES_KEY = ["rules"] as const;

/** How many rows "apply to similar" would change for this type (or the row's own). */
export function useSimilarCount(id: number, type: TxTypeDto | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: [...TRANSACTIONS_KEY, id, "similar", type ?? null], queryFn: () => api.similarCount(id, type), enabled });
}

export function useRules() {
  const api = useApi();
  return useQuery({ queryKey: RULES_KEY, queryFn: () => api.rules() });
}

/** A deleted rule gives its rows back to automatic recognition: the list, the day and the questions change. */
export function useDeleteRule() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteRule(id),
    onSuccess: () =>
      Promise.all(
        [RULES_KEY, TODAY_KEY, TRANSACTIONS_KEY, CALENDAR_KEY, INSIGHTS_KEY, CASH_KEY, PAYMENTS_KEY].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

// --- categories (В5) ------------------------------------------------------------------
export const CATEGORIES_KEY = ["categories"] as const;

/** The owner's categories in order; null from an older server, which keeps the built-in list. */
export function useCategories() {
  const api = useApi();
  return useQuery({ queryKey: CATEGORIES_KEY, queryFn: () => api.categories() });
}

/** For names and icons: undefined while loading or after an error, null from an older server — all fall back. */
export function useCategoryList(): CategoryList {
  return useCategories().data;
}

/**
 * A change to the list shows wherever a category is named: the operations, «Итоги», the rules. A deleted one also
 * moves its operations and rules to «Без категории».
 */
function useCategoryMutation<V, R>(mutationFn: (vars: V) => Promise<R>, onSaved?: (result: R, client: QueryClient) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result: R) => {
      onSaved?.(result, client);
      return Promise.all([CATEGORIES_KEY, TRANSACTIONS_KEY, INSIGHTS_KEY, RULES_KEY].map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

export function useCreateCategory() {
  const api = useApi();
  // The new category is at the end of the list at once, so its chip is there before the list comes back.
  return useCategoryMutation(
    (input: CategoryInput) => api.createCategory(input),
    (created, client) => client.setQueryData<CategoryDto[] | null>(CATEGORIES_KEY, (list) => (list ? [...list, created] : list)),
  );
}

export function usePatchCategory() {
  const api = useApi();
  return useCategoryMutation(({ key, patch }: { key: string; patch: CategoryPatch }) => api.patchCategory(key, patch));
}

export function useDeleteCategory() {
  const api = useApi();
  return useCategoryMutation((key: string) => api.deleteCategory(key));
}

/** A new order shows at once and goes back if the server refuses it. */
export function useReorderCategories() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) => api.reorderCategories(keys),
    onMutate: async (keys: string[]) => {
      await client.cancelQueries({ queryKey: CATEGORIES_KEY });
      const before = client.getQueryData<CategoryDto[] | null>(CATEGORIES_KEY);
      if (before) {
        const byKey = new Map(before.map((c) => [c.key, c]));
        client.setQueryData(CATEGORIES_KEY, keys.map((k) => byKey.get(k)).filter((c): c is CategoryDto => c !== undefined));
      }
      return { before };
    },
    onError: (_e, _keys, ctx) => {
      if (ctx?.before) client.setQueryData(CATEGORIES_KEY, ctx.before);
    },
    onSuccess: (saved) => client.setQueryData(CATEGORIES_KEY, saved),
    onSettled: () => Promise.all([CATEGORIES_KEY, INSIGHTS_KEY].map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

/**
 * How many operations a category has, asked at the moment the deletion is confirmed, so the question never shows
 * before the number has come; null when the server does not say or the request fails.
 */
export function useCategoryCount(): (key: string) => Promise<number | null> {
  const api = useApi();
  const client = useQueryClient();
  return async (key) => {
    try {
      return await client.fetchQuery({
        queryKey: [...TRANSACTIONS_KEY, "category-count", key],
        queryFn: async () => (await api.transactions({ group: "all", category: key })).summary?.count ?? null,
        staleTime: 0,
      });
    } catch {
      return null;
    }
  };
}
