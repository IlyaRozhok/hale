import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState } from "react-native";

// The reduce-motion setting is asked for once, when the app's code loads, and then followed. A screen that mounts
// later has the answer on its very first render, so it can tell at once whether to play its entrance (task ЧЛ8);
// asked for on mount, the answer came a moment after the first picture, too late to start from.
let reduceMotion: boolean | null = null;
/** The setting changed after we asked: the first answer, still on its way, is older than the change. */
let heard = false;
const watchers = new Set<() => void>();
const learn = (reduced: boolean) => {
  if (reduceMotion === reduced) return;
  reduceMotion = reduced;
  watchers.forEach((tell) => tell());
};
try {
  AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
    heard = true;
    learn(reduced);
  });
  AccessibilityInfo.isReduceMotionEnabled().then(
    (reduced) => heard || learn(reduced),
    () => heard || learn(false),
  );
} catch {
  // No such setting to ask about: motion is allowed, as when the question fails.
  learn(false);
}
const watch = (tell: () => void) => {
  watchers.add(tell);
  return () => {
    watchers.delete(tell);
  };
};
const reducedNow = () => reduceMotion ?? true;

/** Live reduce-motion setting. Assumes reduced until known, so nothing animates by surprise. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(watch, reducedNow);
}

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}
