import { useCallback, useState } from "react";

/**
 * The spinner belongs to the owner's pull. A background refetch must not show it: on iOS setting
 * `refreshing` from code shifts the content and can leave the indicator stuck.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().catch(() => undefined).finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}
