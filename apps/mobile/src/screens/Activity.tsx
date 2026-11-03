import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@hale/tokens";
import type { TransactionDto } from "@hale/contracts";
import { useTransactions } from "../api/queries";
import { Chip } from "../components/Chip";
import { Glass } from "../components/Glass";
import { RecipientLabelSheet } from "../components/RecipientLabelSheet";
import { TxEditSheet } from "../components/TxEditSheet";
import { TxRow } from "../components/TxRow";

const { color, radius, space, touchMin, type } = tokens;

/** The operations list: newest first, pages by cursor, a filter for rows that wait for an answer. */
export function Activity() {
  const insets = useSafeAreaInsets();
  const [onlyAsk, setOnlyAsk] = useState(false);
  const [open, setOpen] = useState<TransactionDto | null>(null);
  // A row waiting for an answer opens the label sheet; "Изменить тип" there switches to the full editor.
  const [forceEdit, setForceEdit] = useState(false);
  const close = () => {
    setOpen(null);
    setForceEdit(false);
  };
  const list = useTransactions(onlyAsk);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.title}>Операции</Text>
      <View style={styles.filters}>
        <Chip label="Нужен ответ" selected={onlyAsk} onPress={() => setOnlyAsk((v) => !v)} />
      </View>
      {list.isError && items.length === 0 ? (
        <Glass style={styles.stack}>
          <Text style={styles.text}>Не получилось загрузить операции. Проверьте связь и попробуйте ещё раз.</Text>
          <Pressable accessibilityRole="button" onPress={() => void list.refetch()} style={styles.button}>
            <Text style={styles.buttonText}>Повторить</Text>
          </Pressable>
        </Glass>
      ) : (
        <FlatList
          testID="activity-list"
          data={items}
          keyExtractor={(t) => String(t.id)}
          renderItem={({ item }) => <TxRow tx={item} onPress={() => setOpen(item)} />}
          ItemSeparatorComponent={Gap}
          contentContainerStyle={{ paddingBottom: space.xl }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => void list.refetch()}
          ListEmptyComponent={
            list.isPending ? <ActivityIndicator color={color.fg.muted} /> : <Text style={styles.muted}>{onlyAsk ? "Ответов никто не ждёт." : "Операций пока нет."}</Text>
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={color.fg.muted} style={styles.footer} /> : undefined}
        />
      )}
      {open && open.needsLabel && !forceEdit && (
        <RecipientLabelSheet
          counterKey={open.counterKey}
          name={open.counterName ?? open.description}
          onClose={close}
          onEditType={() => setForceEdit(true)}
        />
      )}
      {open && (!open.needsLabel || forceEdit) && <TxEditSheet tx={open} onClose={close} />}
    </View>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base, paddingHorizontal: space.xl, gap: space.md },
  title: { ...type.title, color: color.fg.default },
  filters: { flexDirection: "row", gap: space.sm },
  gap: { height: space.sm },
  stack: { gap: space.md },
  text: { ...type.body, color: color.fg.default },
  muted: { ...type.body, color: color.fg.muted },
  footer: { paddingVertical: space.lg },
  button: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  buttonText: { ...type.label, color: color.accent.fgOnAccent },
});
