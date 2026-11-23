import { type ReactNode, useCallback, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { shouldCloseSheet, shouldDragSheet } from "./sheetGesture";

const { color, radius, space, touchMin, type } = tokens;

const OPEN_MS = 280;
const CLOSE_MS = 200;

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /**
   * The panel has slid in. A field that wants the keyboard at once focuses here, not with autoFocus: a keyboard that
   * rises while the panel still slides re-lays the sheet out, and on the phone the panel stays off the screen, under
   * its own scrim, until the next tap.
   */
  onOpened?: () => void;
  children: ReactNode;
  /**
   * Pinned under the scrolling body, always in sight (task ЯМ2): the sheet's own buttons, so a long list above them
   * does not push them off the screen. Without it the sheet is as it always was.
   */
  footer?: ReactNode;
};

/**
 * A bottom sheet: glass over a scrim that fades in place, so only the panel moves. Closed with a
 * button, by tapping outside or by swiping it down.
 */
export function Sheet({ title, subtitle, onClose, onOpened, children, footer }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const scrollTop = useRef(0);
  const closing = useRef(false);
  const still = useRef(false);
  const opened = useRef(onOpened);
  opened.current = onOpened;

  const animate = useCallback(
    (toValue: number, ms: number, done?: (result: { finished: boolean }) => void) =>
      Animated.timing(shown, {
        toValue,
        duration: still.current ? 0 : ms,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(done),
    [shown],
  );

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      still.current = reduced === true;
      animate(1, OPEN_MS, ({ finished }) => {
        if (finished && !closing.current) opened.current?.();
      });
    });
  }, [animate]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    animate(0, CLOSE_MS, onClose);
  }, [animate, onClose]);

  // Plain touch events: they reach the panel in every case. A press under a long drag cancels itself,
  // as the finger leaves the button.
  const touch = useRef({ x: 0, y: 0, lastY: 0, lastT: 0, speed: 0, dragging: false });

  const onTouchStart = (e: GestureResponderEvent) => {
    const { pageX, pageY, timestamp } = e.nativeEvent;
    touch.current = { x: pageX, y: pageY, lastY: pageY, lastT: timestamp, speed: 0, dragging: false };
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    const t = touch.current;
    const { pageX, pageY, timestamp } = e.nativeEvent;
    const dy = pageY - t.y;
    if (!t.dragging && !shouldDragSheet({ dx: pageX - t.x, dy }, scrollTop.current)) return;
    t.dragging = true;
    if (timestamp > t.lastT) t.speed = (pageY - t.lastY) / (timestamp - t.lastT);
    t.lastY = pageY;
    t.lastT = timestamp;
    drag.setValue(Math.max(0, dy));
  };

  const goBack = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();

  const onTouchEnd = () => {
    const t = touch.current;
    if (!t.dragging) return;
    t.dragging = false;
    if (shouldCloseSheet({ dy: t.lastY - t.y, vy: t.speed })) close();
    else goBack();
  };

  const onTouchCancel = () => {
    if (!touch.current.dragging) return;
    touch.current.dragging = false;
    goBack();
  };

  const translateY = Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag);

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: shown }]}>
          <Pressable accessible={false} onPress={close} style={styles.fill} />
        </Animated.View>
        <Animated.View
          testID="sheet-panel"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          style={[styles.slider, { transform: [{ translateY }] }]}
        >
          <Glass kind="floating" style={[styles.panel, { paddingBottom: insets.bottom + space.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              <View style={styles.titles}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={close} style={styles.close}>
                <Text style={styles.closeText}>Закрыть</Text>
              </Pressable>
            </View>
            <ScrollView
              testID="sheet-body"
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollTop.current = e.nativeEvent.contentOffset.y;
              }}
            >
              {children}
            </ScrollView>
            {footer !== undefined && (
              <View testID="sheet-footer" style={styles.footer}>
                {footer}
              </View>
            )}
          </Glass>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...(StyleSheet.absoluteFill as object), backgroundColor: color.surface.scrim },
  fill: { flex: 1 },
  slider: { maxHeight: "85%" },
  panel: {
    flexShrink: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    gap: space.md,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.full, backgroundColor: color.fg.subtle },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  titles: { flex: 1 },
  title: { ...type.title, color: color.fg.default },
  subtitle: { ...type.body, color: color.fg.muted },
  close: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.sm },
  closeText: { ...type.label, color: color.fg.muted },
  body: { gap: space.md, paddingBottom: space.md },
  // Outside the scroll, so it never shrinks; the hairline marks where the choices scroll under it.
  footer: {
    flexShrink: 0,
    gap: space.xs,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.card.edge,
  },
});
