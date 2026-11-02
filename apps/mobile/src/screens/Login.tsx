import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tokens } from "@tablo/tokens";
import { useApi } from "../api/context";
import { NetworkError, UnauthorizedError } from "../api/client";

const { color, radius, space, touchMin, type } = tokens;

type Props = { onSignedIn: (token: string) => void | Promise<void>; deviceName: string };

export function Login({ onSignedIn, deviceName }: Props) {
  const api = useApi();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    let token: string;
    try {
      token = await api.login(password, deviceName);
    } catch (e) {
      setError(
        e instanceof UnauthorizedError
          ? "Пароль не подошёл. Попробуйте ещё раз."
          : e instanceof NetworkError
            ? "Нет связи с сервером. Проверьте интернет."
            : "Не получилось войти. Попробуйте чуть позже.",
      );
      setBusy(false);
      return;
    }
    try {
      await onSignedIn(token);
    } catch {
      setError("Не удалось сохранить вход на этом устройстве. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={styles.form}>
        <Text style={styles.title}>Табло</Text>
        <TextInput
          accessibilityLabel="Пароль"
          placeholder="Пароль"
          placeholderTextColor={color.fg.subtle}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" onPress={submit} disabled={busy} style={[styles.button, busy && styles.busy]}>
          <Text style={styles.buttonText}>Войти</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface.base, justifyContent: "center", padding: space.xl },
  form: { gap: space.lg },
  title: { ...type.display, color: color.fg.default },
  input: {
    minHeight: touchMin,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface.raised,
    color: color.fg.default,
    ...type.body,
  },
  error: { ...type.body, color: color.fg.default },
  button: {
    minHeight: touchMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.accent.default,
  },
  busy: { opacity: 0.6 },
  buttonText: { ...type.label, color: color.accent.fgOnAccent },
});
