import { useState } from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { tokens } from "@hale/tokens";
import { Segmented } from "./Segmented";

type Key = "a" | "b" | "c";
const OPTIONS = [
  { key: "a", label: "Первое" },
  { key: "b", label: "Второе" },
  { key: "c", label: "Третье" },
] as const;

const selected = (name: string) => screen.getByRole("button", { name }).props.accessibilityState.selected as boolean;

/** A parent that follows every change. */
function Following({ onChange }: { onChange?: (k: Key) => void }) {
  const [value, setValue] = useState<Key>("b");
  return (
    <Segmented
      testID="seg"
      options={OPTIONS}
      value={value}
      onChange={(k) => {
        onChange?.(k);
        setValue(k);
      }}
    />
  );
}

describe("Segmented", () => {
  it("is the native control in its dark appearance, with no tint, the touch minimum high", async () => {
    await render(<Segmented testID="seg" options={OPTIONS} value="a" onChange={jest.fn()} />);
    const control = screen.getByTestId("seg");
    expect(control.props.accessibilityHint).toBe("dark");
    expect((StyleSheet.flatten(control.props.style) as { height?: number }).height).toBeGreaterThanOrEqual(tokens.touchMin);
    expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel as string)).toEqual(["Первое", "Второе", "Третье"]);
  });

  it("shows the value and reports a tapped segment by its key", async () => {
    const onChange = jest.fn();
    await render(<Following onChange={onChange} />);
    expect(selected("Второе")).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Третье" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(selected("Третье")).toBe(true);
    expect(selected("Второе")).toBe(false);
  });

  it("a tap on the chosen segment reports nothing, as the native one", async () => {
    const onChange = jest.fn();
    await render(<Following onChange={onChange} />);
    await fireEvent.press(screen.getByRole("button", { name: "Второе" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an unknown value shows the first segment", async () => {
    await render(<Segmented options={OPTIONS} value={"z" as Key} onChange={jest.fn()} />);
    expect(selected("Первое")).toBe(true);
  });

  it("a value the parent sets back after a tap is shown (a move from another screen resets the kind)", async () => {
    const onChange = jest.fn();
    const ui = (value: Key) => <Segmented options={OPTIONS} value={value} onChange={onChange} />;
    const { rerender } = await render(ui("a"));
    await fireEvent.press(screen.getByRole("button", { name: "Третье" }));
    await rerender(ui("c"));
    expect(selected("Третье")).toBe(true);
    await rerender(ui("a"));
    expect(selected("Первое")).toBe(true);
    expect(selected("Третье")).toBe(false);
  });

  it("a parent that did not follow a tap gets its value back once the control is enabled again", async () => {
    const onChange = jest.fn();
    const ui = (disabled: boolean) => <Segmented options={OPTIONS} value="a" disabled={disabled} onChange={onChange} />;
    const { rerender } = await render(ui(false));
    await fireEvent.press(screen.getByRole("button", { name: "Второе" }));
    expect(onChange).toHaveBeenCalledWith("b");
    // A save in flight: the tapped segment stays.
    await rerender(ui(true));
    expect(selected("Второе")).toBe(true);
    expect(screen.getByRole("button", { name: "Первое" }).props.accessibilityState.disabled).toBe(true);
    // It failed: the value the screen holds is shown again.
    await rerender(ui(false));
    expect(selected("Первое")).toBe(true);
    expect(selected("Второе")).toBe(false);
  });
});
