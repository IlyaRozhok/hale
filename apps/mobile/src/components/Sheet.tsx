import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";

const { color, radius, space, touchMin, type } = tokens;

type Props = { title: string; subtitle?: string; onClose: () => void; children: ReactNode };

/** A bottom sheet: a raised panel over a dark scrim, closed with a button or by tapping outside. */
export function Sheet({ title, subtitle, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        <Pressable accessible={false} onPress={onClose} style={styles.scrim} />
        <View style={[styles.panel, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.head}>
            <View style={styles.titles}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>Закрыть</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill as object, backgroundColor: color.surface.overMetal },
  panel: {
    maxHeight: "85%",
    backgroundColor: color.surface.raised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    gap: space.md,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  titles: { flex: 1 },
  title: { ...type.title, color: color.fg.default },
  subtitle: { ...type.body, color: color.fg.muted },
  close: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.sm },
  closeText: { ...type.label, color: color.fg.muted },
  body: { gap: space.md, paddingBottom: space.md },
});
