import { render, screen } from "@testing-library/react-native";
import { DateField } from "./DateField";
import { dateLabel, kyivDate } from "../format";

const noop = () => undefined;
const year = Number(kyivDate().slice(0, 4));

describe("DateField (Я4)", () => {
  it("shows a date of this year short, «6 дек», and keeps the full date for a screen reader", async () => {
    const value = `${year}-12-06`;
    await render(<DateField label="Срок" value={value} onChange={noop} />);
    expect(screen.getByText("6 дек")).toBeTruthy();
    expect(screen.queryByText(dateLabel(value))).toBeNull();
    expect(screen.getByRole("button", { name: `Срок: ${dateLabel(value)}` })).toBeTruthy();
  });

  it("adds the year to a date in another year", async () => {
    await render(<DateField label="Срок" value={`${year + 1}-01-06`} onChange={noop} />);
    expect(screen.getByText(`6 янв ${year + 1}`)).toBeTruthy();
  });

  it("asks to choose while there is no date", async () => {
    await render(<DateField label="Срок" value="" onChange={noop} />);
    expect(screen.getByText("Выбрать")).toBeTruthy();
  });
});
