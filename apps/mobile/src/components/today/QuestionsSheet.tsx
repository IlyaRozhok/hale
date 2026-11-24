import { useEffect, useState } from "react";
import type { TodayDto } from "@hale/contracts";
import {
  useAnswerCashCard,
  useConfirmIncome,
  useDepositFromWallet,
  useDismissPaymentMatch,
  useDismissUsdcMatch,
  useMatchUsdc,
  usePayWith,
  useSetIncomeDate,
} from "../../api/queries";
import { QuestionCard, eventIdOf } from "../QuestionCard";
import { RecipientLabelSheet } from "../RecipientLabelSheet";
import { Sheet } from "../Sheet";
import { UsdcArrivedSheet } from "../UsdcArrivedSheet";

/** The questions still waiting: a date question with no income event cannot be answered; an older cached answer may still hold one. */
export function openQuestions(data: TodayDto, answered: ReadonlySet<string>): TodayDto["questions"] {
  return data.questions.filter((q) => !answered.has(q.id) && !(q.kind === "income_date" && eventIdOf(q.id) === null));
}

/**
 * The «Осталось разобрать» sheet of «Сегодня»: the open questions and the calls that answer them.
 *
 * Contract:
 * - The screen keeps this component mounted and says with `open` whether the list is shown, so the answering calls
 *   live as long as the screen does and an answer still running when the list was closed ends as before.
 * - `questions` is `openQuestions(data, answered)`: the screen owns the set of answers hidden while their call runs,
 *   because the bell and the phrase of the day count the same list. `onHide(id, true)` hides a question when its
 *   answer starts, `onHide(id, false)` brings it back when the call failed.
 * - `onClose` closes the list; `onLastAnswered` is called when the last card was answered and must close the list
 *   only if it is still the one open (a late answer must not close another sheet).
 * - `onOpenActivity` is called after the list closed itself, for a card that sends to the operations.
 * - The recipient and arrival sheets live inside the list and are dropped whenever it is not open.
 */
export function QuestionsSheet({
  open,
  questions,
  today,
  onHide,
  onClose,
  onLastAnswered,
  onOpenActivity,
}: {
  open: boolean;
  questions: TodayDto["questions"];
  /** The Kyiv day the data is for, ISO. */
  today: string;
  onHide: (id: string, on: boolean) => void;
  onClose: () => void;
  onLastAnswered: () => void;
  onOpenActivity: () => void;
}) {
  const confirmIncome = useConfirmIncome();
  const setIncomeDate = useSetIncomeDate();
  const matchUsdc = useMatchUsdc();
  const dismissUsdc = useDismissUsdcMatch();
  const fromWallet = useDepositFromWallet();
  const cashCard = useAnswerCashCard();
  const payWith = usePayWith();
  const notPaidBy = useDismissPaymentMatch();
  const [labeling, setLabeling] = useState<{ id: string; counterKey: string; name: string } | null>(null);
  const [arriving, setArriving] = useState<{ id: string; eventId: number; expectedAmount: number } | null>(null);
  // The recipient and arrival sheets live inside the list: when it closes, however it closes, they are dropped too,
  // so the list never reopens on top of an old, already answered question.
  useEffect(() => {
    if (!open) {
      setLabeling(null);
      setArriving(null);
    }
  }, [open]);

  if (!open) return null;

  const answer = (id: string, run: () => Promise<unknown>) => {
    const last = questions.length <= 1;
    onHide(id, true);
    run().then(
      () => {
        if (last) onLastAnswered();
      },
      () => onHide(id, false),
    );
  };

  return (
    <Sheet title="Осталось разобрать" onClose={onClose}>
      {questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          today={today}
          onOpenActivity={() => {
            onClose();
            onOpenActivity();
          }}
          onLabelRecipient={(counterKey) => setLabeling({ id: q.id, counterKey, name: q.subject ?? q.text.replace(/^Кто это:\s*/, "").replace(/\?$/, "") })}
          onConfirmUsdc={(eventId) => answer(q.id, () => confirmIncome.mutateAsync({ eventId }))}
          onUsdcOther={(eventId, expectedAmount) => setArriving({ id: q.id, eventId, expectedAmount })}
          onMatchUsdc={(eventId, transactionId) => answer(q.id, () => matchUsdc.mutateAsync({ eventId, transactionId }))}
          onDismissUsdc={(transactionId) => answer(q.id, () => dismissUsdc.mutateAsync(transactionId))}
          onCashFromWallet={(transactionId) => answer(q.id, () => fromWallet.mutateAsync(transactionId))}
          onCashCard={(transactionId, reply) => answer(q.id, () => cashCard.mutateAsync({ id: transactionId, answer: reply }))}
          onPayWith={(paymentId, transactionId) => answer(q.id, () => payWith.mutateAsync({ paymentId, transactionIds: [transactionId] }))}
          onNotPaidBy={(paymentId, transactionId) => answer(q.id, () => notPaidBy.mutateAsync({ paymentId, transactionId }))}
          onSetDate={(eventId, date) => answer(q.id, () => setIncomeDate.mutateAsync({ eventId, date }))}
        />
      ))}
      {/* Inside the list's modal: iOS presents it on top, and closing it returns to the list. */}
      {labeling && (
        <RecipientLabelSheet
          counterKey={labeling.counterKey}
          name={labeling.name}
          onClose={() => setLabeling(null)}
          onLabeled={() => {
            // Called once the label is saved: the last card closes the list too, as a one-tap answer does (Я9).
            if (questions.length <= 1) onLastAnswered();
            onHide(labeling.id, true);
          }}
        />
      )}
      {arriving && (
        <UsdcArrivedSheet
          eventId={arriving.eventId}
          expectedAmount={arriving.expectedAmount}
          onClose={() => setArriving(null)}
          onSaved={() => {
            // The same ending as a one-tap answer: the last card closes the list too.
            if (questions.length <= 1) onLastAnswered();
            onHide(arriving.id, true);
          }}
        />
      )}
    </Sheet>
  );
}
