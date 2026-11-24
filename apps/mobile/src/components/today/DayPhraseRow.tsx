import { useEffect } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { tokens } from "@hale/tokens";
import type { ObservationRef } from "@hale/contracts";
import { observationRef, type Phrase, type PhraseAction } from "../../dayPhrase";

const { color, space, touchMin, type } = tokens;

/**
 * The phrase of the day: one pressable line.
 *
 * Contract: the screen builds the phrase (`dayPhrase`) and decides what its action opens; the row shows the text and
 * hands the action back through `onAct`. When the phrase says an observation (В7), the row tells the server, once a
 * day, that it was shown: `markShown` is the screen's `useMarkObservationShown()`, kept there so its once-a-day
 * memory does not depend on whether a phrase is on the screen.
 */
export function DayPhraseRow({
  phrase,
  date,
  onAct,
  markShown,
}: {
  phrase: Phrase;
  /** The Kyiv day the data is for, ISO. */
  date: string;
  onAct: (action: PhraseAction) => void;
  markShown: (date: string, ref: ObservationRef) => void;
}) {
  const noticed = phrase.action.kind === "observation" ? observationRef(phrase.action.observation) : null;
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => onAct(phrase.action)} style={styles.phraseRow}>
        <Text style={styles.phrase}>{phrase.text}</Text>
      </Pressable>
      {noticed && <MarkShown date={date} which={noticed} mark={markShown} />}
    </>
  );
}

/** Tells the server, once a day, that the phrase showed this observation: from then on it is today's. */
function MarkShown({ date, which, mark }: { date: string; which: ObservationRef; mark: (date: string, ref: ObservationRef) => void }) {
  // `mark` is new on each render and keeps its own once-a-day memory: the observation is what the effect follows.
  useEffect(() => mark(date, which), [date, which.kind, which.category]);
  return null;
}

const styles = StyleSheet.create({
  phraseRow: { minHeight: touchMin, justifyContent: "center", paddingHorizontal: space.xs },
  phrase: { ...type.body, color: color.fg.default },
});
