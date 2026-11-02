import { useEffect } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { clampLevel, shaderTime, stepLevel } from "./level";

/**
 * Drives the shader uniforms on the UI thread. While `running` is false (app in background or
 * reduce-motion on) the frame callback is stopped, so no frames are produced at all; a level
 * change then redraws once.
 */
export function useMetalClock(level: number, running: boolean, reducedMotion: boolean) {
  const target = useSharedValue(clampLevel(level));
  const shown = useSharedValue(clampLevel(level));
  const elapsed = useSharedValue(0);
  const time = useSharedValue(shaderTime(0, reducedMotion));

  useEffect(() => {
    target.value = clampLevel(level);
    if (!running) shown.value = clampLevel(level);
  }, [level, running, target, shown]);

  useEffect(() => {
    time.value = shaderTime(elapsed.value, reducedMotion);
  }, [reducedMotion, elapsed, time]);

  const frame = useFrameCallback((info) => {
    const dt = (info.timeSincePreviousFrame ?? 0) / 1000;
    elapsed.value += dt;
    time.value = shaderTime(elapsed.value, false);
    shown.value = stepLevel(shown.value, target.value, dt, false);
  }, false);

  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  return { time, shown };
}
