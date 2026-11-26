import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

/**
 * The moving parts of an entrance (task ЧЛ8). Each takes `play`, a key of `useEntrance`: 0 — the final state, no
 * motion; a new number above zero — play once from the start. Mounted with a key, a part starts hidden, so its
 * final state is never drawn first. The key going back to 0 cuts nothing short: an animation ends by itself.
 *
 * Only opacity and transforms move, on the native driver: no layout changes and nothing runs on the JS thread; once
 * an animation has ended nothing is left running.
 */
function useEntranceValue(play: number, ms: number, delay = 0): Animated.Value {
  // Made once: a plain `useRef(new Animated.Value(…))` would build a value on every render and throw it away.
  const [value] = useState(() => new Animated.Value(play > 0 ? 0 : 1));
  const running = useRef<Animated.CompositeAnimation | null>(null);
  // Before the picture is drawn: a new key over a part already on the screen starts it from zero in the same frame.
  useLayoutEffect(() => {
    if (play === 0) return;
    running.current?.stop();
    value.setValue(0);
    // Ease-out, no overshoot: quick at first, then settling.
    const animation = Animated.timing(value, { toValue: 1, duration: ms, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    running.current = animation;
    animation.start();
  }, [play, ms, delay, value]);
  useEffect(() => () => running.current?.stop(), []);
  return value;
}

/** Fades its children in, `delay` ms after the entrance begins. Takes no room of its own and no touch from them. */
export function Appear({ play, ms, delay, testID, children }: { play: number; ms: number; delay?: number; testID?: string; children: ReactNode }) {
  const opacity = useEntranceValue(play, ms, delay);
  return (
    <Animated.View testID={testID} style={{ opacity }}>
      {children}
    </Animated.View>
  );
}

/**
 * Uncovers its children from the left edge to the right over `ms`: a bar grows, a line draws itself. What is inside
 * is laid out in full from the start and does not move on the screen; only the window it is seen through does (the
 * window slides in from the left, its content slides back by as much).
 *
 * `span` is how far the window travels: the width of the content, or anything wider (then the first moment shows
 * nothing). `style` is the window's own: it takes the content's place in the layout; `innerStyle` lays the content
 * out. `over` is what is written over the picture: it is not behind the window and fades in over the last part of
 * the way.
 */
export function Wipe({
  play,
  ms,
  span,
  style,
  innerStyle,
  testID,
  children,
  over,
}: {
  play: number;
  ms: number;
  span: number;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
  /** Drawn over the content, outside the window; fades in as the window comes to its end. */
  over?: ReactNode;
}) {
  const shown = useEntranceValue(play, ms);
  // Built once for a span, not on every render: a render while the animation runs makes no new animated nodes.
  const { windowX, contentX, overOpacity } = useMemo(
    () => ({
      windowX: shown.interpolate({ inputRange: [0, 1], outputRange: [-span, 0] }),
      contentX: shown.interpolate({ inputRange: [0, 1], outputRange: [span, 0] }),
      overOpacity: shown.interpolate({ inputRange: [0, OVER_FROM, 1], outputRange: [0, 0, 1] }),
    }),
    [shown, span],
  );
  return (
    <>
      <Animated.View testID={testID} style={[style, styles.window, { transform: [{ translateX: windowX }] }]}>
        <Animated.View style={[innerStyle, { transform: [{ translateX: contentX }] }]}>{children}</Animated.View>
      </Animated.View>
      {over !== undefined && (
        <Animated.View testID={testID && `${testID}-over`} style={[StyleSheet.absoluteFill, { opacity: overOpacity }]} pointerEvents="none">
          {over}
        </Animated.View>
      )}
    </>
  );
}

/** The share of the way after which what is written over the picture starts to show. */
const OVER_FROM = 0.6;

const styles = StyleSheet.create({ window: { overflow: "hidden" } });
