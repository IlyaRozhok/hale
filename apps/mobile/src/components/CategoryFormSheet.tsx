import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { CATEGORY_ICONS, type CategoryDto, type CategoryIcon } from "@hale/contracts";
import { ApiError } from "../api/client";
import { useCategoryCount, useCategoryList, useCreateCategory, useDeleteCategory, usePatchCategory } from "../api/queries";
import { isCategoryIcon } from "../categoryIcon";
import { categoryName, deleteCategoryText } from "../labels";
import { ErrorText } from "./ErrorText";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { PrimaryButton } from "./PrimaryButton";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

/** What a screen reader says for each icon of the set. */
const ICON_NAMES: Record<CategoryIcon, string> = {
  cart: "корзина",
  coffee: "чашка",
  car: "машина",
  repeat: "повтор",
  ticket: "билет",
  heart: "сердце",
  bolt: "молния",
  phone: "телефон",
  bag: "сумка",
  arrowIn: "стрелка",
  circle: "круг",
  home: "дом",
  gift: "подарок",
  book: "книга",
  plane: "самолёт",
  paw: "лапа",
  dumbbell: "гантель",
  user: "человек",
  star: "звезда",
  shirt: "одежда",
  tool: "ключ",
  school: "учёба",
  music: "музыка",
  pill: "таблетка",
  baby: "коляска",
};

/** A new category starts with an icon of the owner's own part of the set, not one of the default categories'. */
const NEW_ICON: CategoryIcon = "star";
const NAME_MAX = 40;

type Props = {
  /** The category to change; none for a new one. */
  category?: CategoryDto;
  onClose: () => void;
  /** A new category was made: the operation it was started from takes it at once. */
  onCreated?: (created: CategoryDto) => void;
};

/**
 * A category's name and icon (task В5). A new one is added at the end of the list. A system one («Возвраты»,
 * «Без категории») keeps its name and is not deleted; only its icon changes.
 */
export function CategoryFormSheet({ category, onClose, onCreated }: Props) {
  const list = useCategoryList();
  const create = useCreateCategory();
  const patch = usePatchCategory();
  const remove = useDeleteCategory();
  const system = category?.system ?? false;
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState<CategoryIcon>(category && isCategoryIcon(category.icon) ? category.icon : NEW_ICON);
  const [message, setMessage] = useState<string | null>(null);
  const count = useCategoryCount(category?.key ?? "", category !== undefined && !system);
  const busy = create.isPending || patch.isPending || remove.isPending;

  const failed = (e: unknown) =>
    setMessage(e instanceof ApiError && e.status === 409 ? "Такая категория уже есть." : "Не удалось сохранить. Попробуйте ещё раз.");

  const save = () => {
    const trimmed = name.trim();
    if (!system && trimmed === "") {
      setMessage("Введите название.");
      return;
    }
    setMessage(null);
    if (!category) {
      create.mutate(
        { name: trimmed, icon },
        {
          onSuccess: (created) => {
            onCreated?.(created);
            onClose();
          },
          onError: failed,
        },
      );
      return;
    }
    const changes = {
      ...(!system && trimmed !== category.name ? { name: trimmed } : {}),
      ...(icon !== category.icon ? { icon } : {}),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    patch.mutate({ key: category.key, patch: changes }, { onSuccess: onClose, onError: failed });
  };

  const confirmDelete = () => {
    if (!category) return;
    const n = count.data === undefined ? null : count.data;
    Alert.alert(`Удалить «${category.name}»?`, deleteCategoryText(n, categoryName("uncategorized", list)), [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => remove.mutate(category.key, { onSuccess: onClose, onError: () => setMessage("Не удалось удалить. Попробуйте ещё раз.") }),
      },
    ]);
  };

  return (
    <Sheet
      title={category ? category.name : "Новая категория"}
      subtitle={system ? "Служебная категория: можно сменить только значок" : undefined}
      onClose={onClose}
    >
      {!system && (
        <>
          <Text style={styles.heading}>Название</Text>
          <Field label="Название" value={name} onChangeText={setName} maxLength={NAME_MAX} autoFocus={!category} />
        </>
      )}
      <Text style={styles.heading}>Значок</Text>
      <View style={styles.grid}>
        {CATEGORY_ICONS.map((i) => {
          const on = icon === i;
          return (
            <Pressable
              key={i}
              accessibilityRole="radio"
              accessibilityLabel={`Значок: ${ICON_NAMES[i]}`}
              accessibilityState={{ selected: on }}
              onPress={() => setIcon(i)}
              style={[styles.cell, on && styles.cellOn]}
            >
              <Icon name={i} color={on ? color.accent.fgOnAccent : color.fg.muted} size={20} />
            </Pressable>
          );
        })}
      </View>
      {message && <ErrorText>{message}</ErrorText>}
      <PrimaryButton label={category ? "Сохранить" : "Добавить"} disabled={busy} onPress={save} />
      {category && !system && (
        <Pressable accessibilityRole="button" accessibilityLabel="Удалить" disabled={busy} onPress={confirmDelete} style={styles.delete}>
          <Text style={styles.deleteText}>Удалить</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const CELL = touchMin;

const styles = StyleSheet.create({
  heading: { ...type.label, color: color.fg.muted },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.surface.overlay,
  },
  cellOn: { backgroundColor: color.accent.default },
  delete: { minHeight: touchMin, alignItems: "center", justifyContent: "center" },
  deleteText: { ...type.label, color: color.status.danger },
});
