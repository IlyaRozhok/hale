import { Alert } from "react-native";
import type { TodayDto } from "@hale/contracts";
import { ApiError } from "../../api/client";
import { useCancelBridge, useChooseBridge } from "../../api/queries";
import { BridgePlan } from "../BridgePlan";
import { Sheet } from "../Sheet";

/**
 * The «План до дохода» sheet of «Сегодня»: choosing, confirming and cancelling the bridge plan.
 *
 * Contract: the screen keeps this component mounted and says with `open` whether the sheet is shown, so the two
 * calls live as long as the screen does: a confirm still running when the sheet was closed keeps its «pending» state
 * and its ending. `onClose` closes the sheet; `onDone` is called when a confirm or a cancel succeeded and must close
 * the sheet only if it is still the one open (a late answer must not close another). With no `state.bridge` nothing
 * is drawn.
 */
export function BridgeSheet({ open, data, onClose, onDone }: { open: boolean; data: TodayDto; onClose: () => void; onDone: () => void }) {
  const chooseBridge = useChooseBridge();
  const cancelBridge = useCancelBridge();
  const { state } = data;
  if (!open || !state.bridge) return null;
  return (
    <Sheet
      title="План до дохода"
      onClose={() => {
        chooseBridge.reset(); // a failed confirm is not carried to the next time the plan opens
        onClose();
      }}
    >
      <BridgePlan
        state={state}
        usdRate={data.usdRate}
        creditLimit={data.accounts.credit}
        confirming={chooseBridge.isPending}
        zeroOn={data.runway?.zeroOn ?? null}
        today={data.date}
        onMove={() => {
          if (chooseBridge.isError) chooseBridge.reset();
        }}
        confirmFailed={chooseBridge.error ? (chooseBridge.error instanceof ApiError && chooseBridge.error.status === 422 ? "refused" : "failed") : null}
        onConfirm={(amount) => chooseBridge.mutate(amount, { onSuccess: onDone })}
        onCancel={() => cancelBridge.mutate(undefined, {
            onSuccess: onDone,
            onError: () => Alert.alert("Не удалось отменить план", "Проверьте связь и попробуйте ещё раз."),
          })}
      />
    </Sheet>
  );
}
