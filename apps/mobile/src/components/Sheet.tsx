import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import { Glass } from "./Glass";
import { shouldCloseSheet, shouldDragSheet } from "./sheetGesture";

const { color, radius, space, touchMin, type } = tokens;

const OPEN_MS = 280;
const CLOSE_MS = 200;

type Props = { title: string; subtitle?: string; onClose: () => void; children: ReactNode };

/**
 * A bottom sheet: glass over a scrim that fades in place, so only the panel moves. Closed with a
 * button, by tapping outside or by swiping it down.
 */
export function Sheet({ title, subtitle, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const scrollTop = useRef(0);
  const closing = useRef(false);
  const still = useRef(false);

  const animate = useCallback(
    (toValue: number, ms: number, done?: () => void) =>
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
      animate(1, OPEN_MS);
    });
  }, [animate]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    animate(0, CLOSE_MS, onClose);
  }, [animate, onClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => shouldDragSheet(g, scrollTop.current),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (shouldCloseSheet(g)) close();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
      }),
    [close, drag],
  );

  const translateY = Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag);

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: shown }]}>
          <Pressable accessible={false} onPress={close} style={styles.fill} />
        </Animated.View>
        <Animated.View {...pan.panHandlers} style={[styles.slider, { transform: [{ translateY }] }]}>
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
});
