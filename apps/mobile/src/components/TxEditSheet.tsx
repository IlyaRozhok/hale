import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import type { CashAnswerDto, CashDepositAnswerName, TransactionDto, TransactionPatch } from "@hale/contracts";
import { useCategoryList, useChangeDepositAnswer, useEditTransaction, useSetCardCash, useSimilarCount } from "../api/queries";
import { categoryIconOf } from "../categoryIcon";
import { cardTransferTitle, dayMonth, formatMoney, formatSignedMoney, formatSignedOriginal, two } from "../format";
import { AmountForm } from "./AmountForm";
import { accountLabel, alwaysCountText, answerText, categoryChoices, categoryName, limitFact, typeChips, typeLabel, usualWantText } from "../labels";
import { CategoryFormSheet, WantSwitch } from "./CategoryFormSheet";
import { ErrorText } from "./ErrorText";
import { ActionRow } from "./ActionRow";
import { Chip } from "./Chip";
import { CategoryChip } from "./CategoryChip";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

const { color, radius, space, touchMin, type } = tokens;

type Props = { tx: TransactionDto; onClose: () => void; /** Present when the row is a transfer to someone. */ onAnswer?: () => void };

/** A moment in the device's local time: "10 ноя, 14:32". */
function dateTime(iso: string): string {
  const d = new Date(iso);
  const { day, month } = dayMonth(`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`);
  return `${day} ${month}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Which operation this is: the figure its list row shows, when it happened and on which account. */
function facts(tx: TransactionDto): string {
  const amount = tx.amountUah !== null ? formatSignedMoney(tx.amountUah) : formatSignedOriginal(tx.amount, tx.currency);
  return [amount, dateTime(tx.occurredAt), accountLabel(tx.accountKind)].filter((part) => part !== null).join(" · ");
}

/** How much of a spend came from the credit limit: a reference line, not a warning. Null when none. */
function creditText(tx: TransactionDto): string | null {
  if (tx.creditPart == null) return null;
  // Compared in whole hryvnias, as formatMoney shows them: never "₴0 — …", never "₴161 — …" under −₴161.
  const part = Math.round(tx.creditPart / 100);
  if (part <= 0) return null;
  return part >= Math.round(Math.abs(tx.amount) / 100) ? "Оплачено из кредитного лимита" : `${formatMoney(tx.creditPart)} — из кредитного лимита`;
}

type Change = Pick<TransactionPatch, "type" | "category">;

/**
 * The operation on top with its facts first (ЯМ3): whether the bank still processes it and whether the day's limit
 * counts it. Then its category — the chosen one alone, the whole list behind «Изменить» — and its type, folded into
 * one row «Ещё: тип операции»; each is changed with one tap for this operation alone. After a change a quiet card
 * asks «Всегда так для …?» (task В5): «Да, всегда» sends the same change for the similar ones, exactly what the
 * «Применить к похожим» switch did; no answer leaves only this operation changed. The rare types wait behind "Ещё".
 * A purchase in a category with a side has «Эта покупка» (task В6): «нужное» or «желаемое» for it alone, saved at
 * once in a request of its own, with no question about the similar ones.
 */
export function TxEditSheet({ tx, onClose, onAnswer }: Props) {
  const edit = useEditTransaction();
  const always = useEditTransaction();
  const side = useEditTransaction();
  const list = useCategoryList();
  // The sheet opens with a snapshot of the row; what was saved shows here at once.
  const [row, setRow] = useState(tx);
  const [asked, setAsked] = useState<Change | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  // The whole category list, opened by «Изменить»; a row with no category yet has nothing to fold back to.
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = useSimilarCount(tx.id, asked?.type, asked !== null);
  const busy = edit.isPending || always.isPending || side.isPending;

  // A rule needs a type: an operation without one is only ever changed alone.
  const ask = (change: Change, type: TransactionDto["type"]) => setAsked(type ? change : null);

  const save = (change: Change) => {
    setFailed(false);
    setAsked(null);
    edit.mutate(
      // This operation alone, as the switch turned off did.
      { id: tx.id, patch: { ...change, applyToSimilar: false } },
      {
        onSuccess: (result) => {
          setRow(result.transaction);
          setChoosing(false);
          ask(change, result.transaction.type);
        },
        onError: () => setFailed(true),
      },
    );
  };
  // The category it already has: nothing to save, but the owner may want it for the similar ones.
  const pickCategory = (key: string) => {
    if (row.category !== key) return save({ category: key });
    setChoosing(false);
    ask({ category: key }, row.type);
  };
  const pickType = (type: NonNullable<TransactionDto["type"]>) => (row.type === type ? ask({ type }, row.type) : save({ type }));

  // The side of its category, from the server's list; none for a system one or from an older server.
  const categoryWant = list?.find((c) => c.key === row.category)?.want;
  // A wallet row is changed only in the cash wallet, and the server refuses it here. A category change keeps the own
  // choice on the server: the row it sends back says which side the purchase is on now.
  const sided = row.type === "spend" && row.accountKind !== "cash" && typeof categoryWant === "boolean" && typeof row.want === "boolean";
  const pickWant = (want: boolean) => {
    if (!sided || want === row.want) return;
    setFailed(false);
    side.mutate(
      // The category's own side gives the purchase back to it.
      { id: tx.id, patch: { want: want === categoryWant ? null : want } },
      { onSuccess: (result) => setRow(result.transaction), onError: () => setFailed(true) },
    );
  };

  const yes = () => {
    if (!asked) return;
    setFailed(false);
    always.mutate({ id: tx.id, patch: { ...asked, applyToSimilar: true } }, { onSuccess: onClose, onError: () => setFailed(true) });
  };

  const named = tx.counterName ?? tx.description;
  // A masked card number reads as words in the heading (Я3); the note and the rule question keep the bank's name.
  const title = tx.counterName ?? cardTransferTitle(tx.description, tx.amount) ?? tx.description;
  const types = typeChips(row.amount, row.type);
  const credit = creditText(tx);
  const askedName = asked === null ? "" : asked.type !== undefined ? typeLabel(asked.type) : categoryName(asked.category ?? null, list);
  const more = asked !== null && count.data !== undefined ? alwaysCountText(count.data, askedName) : null;
  // The saved row: a new type can move it in or out of the limit, and the server's answer says which.
  const limit = limitFact(row);
  const listed = choosing || row.category === null;

  return (
    <Sheet title={title} subtitle={facts(tx)} onClose={onClose}>
      {/* The list only quiets a held amount (ЯМ2); here it is said what that means. An older server sends neither
          field: no fact lines. */}
      {tx.hold === true && <Fact icon="circle" text="В обработке у банка — сумма может немного измениться" />}
      {limit !== null && <Fact icon={limit.icon} text={limit.text} />}
      {tx.description !== "" && tx.description !== named && <Text style={styles.note}>{tx.description}</Text>}
      {credit !== null && <Text style={styles.note}>{credit}</Text>}
      {onAnswer && <ActionRow label={`Что это за перевод: ${answerText(tx.recipientLabel)}`} onPress={onAnswer} />}
      {tx.cashOut !== null && <CardCash tx={tx} cashOut={tx.cashOut} />}
      {tx.cashAnswer != null && <CashSource id={tx.id} answer={tx.cashAnswer} onChanged={onClose} />}
      <View style={styles.header}>
        <Text style={styles.heading}>Категория</Text>
        {choosing && row.category !== null && <Link label="Свернуть" onPress={() => setChoosing(false)} />}
      </View>
      {listed ? (
        <View style={styles.chips}>
          {categoryChoices(list).map((c) => (
            <CategoryChip
              key={c.key}
              label={c.name}
              icon={categoryIconOf(c.key, list)}
              selected={row.category === c.key}
              disabled={busy}
              onPress={() => pickCategory(c.key)}
            />
          ))}
          {/* Only a server that keeps categories can add one. */}
          {list && <CategoryChip label="Новая" icon="plus" disabled={busy} onPress={() => setCreating(true)} />}
        </View>
      ) : (
        <View style={styles.chosen}>
          <CategoryChip label={categoryName(row.category, list)} icon={categoryIconOf(row.category, list)} selected onPress={() => setChoosing(true)} />
          <Link label="Изменить" onPress={() => setChoosing(true)} />
        </View>
      )}
      {asked !== null && (
        <View style={styles.ask}>
          <Text style={styles.text}>{"Всегда так для «{name}»?".replace("{name}", named)}</Text>
          {more !== null && <Text style={styles.note}>{more}</Text>}
          <View style={styles.answers}>
            <Answer label="Да, всегда" strong disabled={busy} onPress={yes} />
            <Answer label="Только эта" disabled={busy} onPress={() => setAsked(null)} />
          </View>
        </View>
      )}
      {sided && (
        <View style={styles.stack}>
          <Text style={styles.heading}>Эта покупка</Text>
          <WantSwitch value={row.want === true} disabled={busy} onChange={pickWant} />
          <Text style={styles.note}>{usualWantText(categoryName(row.category, list), categoryWant === true)}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ещё: тип операции"
        accessibilityValue={{ text: typeLabel(row.type) }}
        accessibilityState={{ expanded: showTypes }}
        onPress={() => setShowTypes((v) => !v)}
        style={styles.more}
      >
        <Text style={styles.text}>Ещё: тип операции</Text>
        <View style={styles.moreValue}>
          <Text style={styles.moreText}>{typeLabel(row.type)}</Text>
          <Icon name={showTypes ? "up" : "down"} color={color.fg.muted} size={16} />
        </View>
      </Pressable>
      {showTypes && (
        <View style={styles.chips}>
          {(allTypes ? [...types.shown, ...types.rest] : types.shown).map((t) => (
            <Chip key={t} label={typeLabel(t)} selected={row.type === t} disabled={busy} onPress={() => pickType(t)} />
          ))}
          {!allTypes && <Chip label="Ещё" onPress={() => setAllTypes(true)} />}
        </View>
      )}
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
      {creating && <CategoryFormSheet onClose={() => setCreating(false)} onCreated={(c) => save({ category: c.key })} />}
    </Sheet>
  );
}

/** One fact about the operation, a small icon before it (ЯМ3). */
function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.fact}>
      <View testID={`fact-icon-${icon}`} style={styles.factIcon}>
        <Icon name={icon} color={color.fg.muted} size={16} />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

function Answer({ label, strong = false, disabled, onPress }: { label: string; strong?: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.answer}>
      <Text style={strong ? styles.answerStrong : styles.answerText}>{label}</Text>
    </Pressable>
  );
}

/** A transfer to the owner's card at another bank: how much of it was taken out as cash. */
function CardCash({ tx, cashOut }: { tx: TransactionDto; cashOut: number }) {
  const set = useSetCardCash();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  // The sheet was opened with a snapshot of the row: what was saved shows here at once.
  const [shown, setShown] = useState(cashOut);
  const full = Math.abs(tx.amountUah ?? tx.amount);
  const save = (amount: number) => {
    setFailed(false);
    set.mutate(
      { id: tx.id, amount },
      {
        onSuccess: () => {
          setShown(amount);
          setEditing(false);
        },
        onError: () => setFailed(true),
      },
    );
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.text}>{shown > 0 ? `Снял наличными: ${formatMoney(shown)}` : "Наличными не снимал"}</Text>
      {editing ? (
        <AmountForm label="Сколько снял" max={full} disabled={set.isPending} onSave={save} />
      ) : (
        <View style={styles.chips}>
          <Link label="Изменить сумму" onPress={() => setEditing(true)} />
          {shown > 0 && <Link label="Не снимал" onPress={() => save(0)} />}
        </View>
      )}
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
    </View>
  );
}

/** What changing a «Вывод с Binance» answer does to the Binance balance, in one calm sentence. */
const BINANCE_NOTE: Record<"returns" | "untouched", string> = {
  returns: "Сумма, которую списал этот ответ, вернётся на Binance — если вы уже поправляли баланс руками, проверьте его после смены ответа.",
  untouched: "Баланс Binance при смене этого ответа не изменится — если нужно, поправьте его в «Плане».",
};

/** A cash deposit: the same choice as «Откуда наличные?», already answered and changeable (task Б21). */
function CashSource({ id, answer, onChanged }: { id: number; answer: CashAnswerDto; onChanged: () => void }) {
  const change = useChangeDepositAnswer();
  const [failed, setFailed] = useState(false);
  const choose = (next: CashDepositAnswerName) => {
    if (next === answer.answer) return;
    setFailed(false);
    change.mutate({ id, answer: next }, { onSuccess: onChanged, onError: () => setFailed(true) });
  };
  const choices: { value: CashDepositAnswerName; label: string }[] = [
    { value: "wallet", label: "Из моих наличных" },
    ...(answer.canBinance ? [{ value: "binance" as const, label: "Вывод с Binance" }] : []),
    { value: "other", label: "Другое" },
  ];
  return (
    <View style={styles.stack}>
      <Text style={styles.heading}>Откуда наличные</Text>
      <View style={styles.chips}>
        {choices.map((c) => (
          <Chip key={c.value} label={c.label} selected={answer.answer === c.value} disabled={change.isPending} onPress={() => choose(c.value)} />
        ))}
      </View>
      {answer.binanceOnChange !== null && <Text style={styles.note}>{BINANCE_NOTE[answer.binanceOnChange]}</Text>}
      {failed && <ErrorText>Не удалось сохранить. Попробуйте ещё раз.</ErrorText>}
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  note: { ...type.caption, color: color.fg.muted },
  link: { minHeight: touchMin, justifyContent: "center" },
  linkText: { ...type.label, color: color.accent.default },
  ask: {
    gap: space.xs,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.card.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.card.edge,
  },
  answers: { flexDirection: "row", gap: space.lg },
  answer: { minHeight: touchMin, justifyContent: "center" },
  answerStrong: { ...type.label, color: color.fg.default },
  answerText: { ...type.label, color: color.fg.muted },
  text: { ...type.body, color: color.fg.default, flexShrink: 1 },
  heading: { ...type.label, color: color.fg.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  factIcon: { paddingTop: 2 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chosen: { flexDirection: "row", alignItems: "center", gap: space.lg },
  more: {
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.card.edge,
  },
  moreValue: { flexDirection: "row", alignItems: "center", gap: space.xs },
  moreText: { ...type.body, color: color.fg.muted },
});
