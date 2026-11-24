import { StyleSheet, Text, View } from "react-native";
import { tokens } from "@hale/tokens";
import { Icon } from "../Icon";

const { color, space, type } = tokens;

/** The mockup's distance from one section of «Сегодня» to the next; the screen already puts `space.md` between its rows. */
export const SECTION_GAP = 26;
/** The top margin a section takes so that, with the screen's own gap, `SECTION_GAP` stands above it. */
export const SECTION_MARGIN = SECTION_GAP - space.md;

/**
 * The header of a section of «Сегодня» (tasks ЧЛ5, ЧЛ6): the title on the left, a quiet caption on the right, and a
 * chevron after it when the header belongs to something that opens. Plain texts: the section around it decides what
 * is read aloud and what is pressed.
 */
export function SectionHead({ title, caption, chevron = false }: { title: string; caption?: string | null; chevron?: boolean }) {
  return (
    <View style={styles.head}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.side}>
        {caption != null && <Text style={styles.caption}>{caption}</Text>}
        {chevron && <Icon name="chevron" color={color.list.chevron} size={14} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  side: { flexDirection: "row", alignItems: "center", gap: 2 },
  title: { ...type.label, fontSize: 15, fontWeight: "600", color: color.fg.default },
  caption: { ...type.label, fontWeight: "400", color: color.fg.muted, fontVariant: ["tabular-nums"] },
});
