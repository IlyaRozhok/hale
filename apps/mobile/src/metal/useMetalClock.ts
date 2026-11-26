import { useEffect, useRef } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { GROW_SECONDS, clampLevel, shaderTime, stepGrow, stepLevel } from "./level";

/**
 * Drives the shader uniforms on the UI thread. While `running` is false (app in background or
 * reduce-motion on) the frame callback is stopped, so no frames are produced at all; a level
 * change then redraws once.
 *
 * `entrance` is the screen's entrance key (task ЧЛ8): with a new one above zero, and only while running, `grown` —
 * the seconds since the entrance began — starts again from zero and the same frame callback moves it on to
 * `GROW_SECONDS`, where it stays. Otherwise it is there from the start: nothing grows.
 */
export function useMetalClock(level: number, running: boolean, reducedMotion: boolean, entrance = 0) {
  const target = useSharedValue(clampLevel(level));
  const shown = useSharedValue(clampLevel(level));
  const elapsed = useSharedValue(0);
  const time = useSharedValue(shaderTime(0, reducedMotion));
  const grown = useSharedValue(entrance > 0 && running ? 0 : GROW_SECONDS);
  const played = useRef(entrance);

  useEffect(() => {
    target.value = clampLevel(level);
    if (!running) shown.value = clampLevel(level);
  }, [level, running, target, shown]);

  useEffect(() => {
    time.value = shaderTime(elapsed.value, reducedMotion);
  }, [reducedMotion, elapsed, time]);

  useEffect(() => {
    if (!running) grown.value = GROW_SECONDS;
    else if (entrance > 0 && entrance !== played.current) grown.value = 0;
    played.current = entrance;
  }, [entrance, running, grown]);

  const frame = useFrameCallback((info) => {
    const dt = (info.timeSincePreviousFrame ?? 0) / 1000;
    elapsed.value += dt;
    time.value = shaderTime(elapsed.value, false);
    shown.value = stepLevel(shown.value, target.value, dt, false);
    if (grown.value < GROW_SECONDS) grown.value = stepGrow(grown.value, dt);
  }, false);

  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  return { time, shown, grown };
}
