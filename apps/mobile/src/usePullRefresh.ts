import { useCallback, useRef, useState } from "react";

/**
 * The spinner belongs to the owner's pull. A background refetch must not show it: on iOS setting
 * `refreshing` from code shifts the content and can leave the indicator stuck.
 *
 * `of` names the list being pulled (Я1). When it changes, the pull is over for this screen: the spinner goes at
 * once, and the old refetch answering later ends nothing, so a pull made on the new list keeps its spinner.
 */
export function usePullRefresh(refetch: () => Promise<unknown>, of?: string) {
  const [pull, setPull] = useState<number | null>(null);
  const [pulled, setPulled] = useState(of);
  const last = useRef(0);
  // Done while rendering, so the old spinner is never shown over the new list, even for one frame.
  if (pulled !== of) {
    setPulled(of);
    setPull(null);
  }
  const onRefresh = useCallback(() => {
    const id = ++last.current;
    setPull(id);
    void refetch()
      .catch(() => undefined)
      .finally(() => setPull((current) => (current === id ? null : current)));
  }, [refetch]);
  return { refreshing: pull !== null, onRefresh };
}
