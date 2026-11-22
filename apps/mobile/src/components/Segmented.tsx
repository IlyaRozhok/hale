import { type ComponentType, useState } from "react";
import { type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import NativeSegmentedControl, { type SegmentedControlProps } from "@react-native-segmented-control/segmented-control";
import { tokens } from "@hale/tokens";

// The library's declared class is not a valid JSX element for this React's types (TS2786); its props are right, so
// only the component's type is restated.
const SegmentedControl = NativeSegmentedControl as unknown as ComponentType<SegmentedControlProps>;

type Props<K extends string> = {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  /** While true the control does not take taps (a save in flight). */
  disabled?: boolean;
  testID?: string;
  /** A width where the control does not span its row (the currency beside an amount). */
  style?: StyleProp<ViewStyle>;
};

/**
 * UIKit's own segmented control (UISegmentedControl; on iOS 26 it is drawn in Liquid Glass by the system), always in
 * its dark appearance and with no tint of ours, so the chosen segment is shown by lightness, not by a colour.
 *
 * The native control moves to a tapped segment by itself. The parent may not follow (a save that fails): the tapped
 * segment is kept here until `value` changes or the control is enabled again, and then `value` is shown — otherwise
 * the same index would never be sent again and the control would stay on a side the screen does not hold.
 * A value that is none of the segments shows none chosen (UISegmentedControlNoSegment).
 */
export function Segmented<K extends string>({ options, value, onChange, disabled = false, testID, style }: Props<K>) {
  const index = options.findIndex((o) => o.key === value);
  // The segment last tapped, while the parent has not answered it by a new value.
  const [tap, setTap] = useState<number | null>(null);
  const [was, setWas] = useState({ index, disabled });
  if (was.index !== index || was.disabled !== disabled) {
    setWas({ index, disabled });
    if (was.index !== index || !disabled) setTap(null);
  }
  const selected = tap ?? index;

  return (
    <SegmentedControl
      testID={testID}
      values={options.map((o) => o.label)}
      selectedIndex={selected}
      enabled={!disabled}
      appearance="dark"
      onChange={(e) => {
        const i = e.nativeEvent.selectedSegmentIndex;
        const option = options[i];
        if (!option) return;
        setTap(i);
        onChange(option.key);
      }}
      style={[styles.control, style]}
    />
  );
}

const styles = StyleSheet.create({
  // The whole control is the touch minimum high: each segment is a target of its own.
  control: { height: tokens.touchMin },
});
