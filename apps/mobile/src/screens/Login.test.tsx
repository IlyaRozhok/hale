import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { tokens } from "@hale/tokens";
import { Login } from "./Login";
import { fakeApi, renderWith } from "../testing";
import { NetworkError, UnauthorizedError } from "../api/client";

describe("Login", () => {
  it("signs in with the password and device name", async () => {
    const api = fakeApi();
    const onSignedIn = jest.fn();
    await renderWith(<Login onSignedIn={onSignedIn} deviceName="iPhone" />, api);
    await fireEvent.changeText(screen.getByLabelText("Пароль"), "secret");
    await fireEvent.press(screen.getByText("Войти"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("token"));
    expect(api.login).toHaveBeenCalledWith("secret", "iPhone");
  });

  it("explains a wrong password in plain words", async () => {
    const api = fakeApi({
      login: jest.fn(async () => {
        throw new UnauthorizedError();
      }),
    });
    await renderWith(<Login onSignedIn={jest.fn()} deviceName="iPhone" />, api);
    await fireEvent.changeText(screen.getByLabelText("Пароль"), "nope");
    await fireEvent.press(screen.getByText("Войти"));
    expect(await screen.findByText("Пароль не подошёл. Попробуйте ещё раз.")).toBeTruthy();
  });

  it("explains a missing connection", async () => {
    const api = fakeApi({
      login: jest.fn(async () => {
        throw new NetworkError();
      }),
    });
    await renderWith(<Login onSignedIn={jest.fn()} deviceName="iPhone" />, api);
    await fireEvent.changeText(screen.getByLabelText("Пароль"), "secret");
    await fireEvent.press(screen.getByText("Войти"));
    expect(await screen.findByText("Нет связи с сервером. Проверьте интернет.")).toBeTruthy();
  });

  it("does not submit an empty password and keeps the button large enough", async () => {
    const api = fakeApi();
    await renderWith(<Login onSignedIn={jest.fn()} deviceName="iPhone" />, api);
    const button = screen.getByRole("button");
    await fireEvent.press(button);
    expect(api.login).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(tokens.touchMin);
  });
});

describe("Login, storage failure", () => {
  it("shows a clear error and lets the owner try again when the token cannot be saved", async () => {
    const api = fakeApi();
    const onSignedIn = jest.fn(async () => {
      throw new Error("keychain");
    });
    await renderWith(<Login onSignedIn={onSignedIn} deviceName="iPhone" />, api);
    await fireEvent.changeText(screen.getByLabelText("Пароль"), "secret");
    await fireEvent.press(screen.getByText("Войти"));
    expect(await screen.findByText("Не удалось сохранить вход на этом устройстве. Попробуйте ещё раз.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Войти"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(2));
  });
});
