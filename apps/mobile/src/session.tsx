import { createContext, useContext, type ReactNode } from "react";

type SignOut = () => void;

const noop: SignOut = () => undefined;

const SessionContext = createContext<SignOut>(noop);

/** Hands the app's sign-out down to the screens that offer it. */
export function SessionProvider({ signOut, children }: { signOut: SignOut; children: ReactNode }) {
  return <SessionContext.Provider value={signOut}>{children}</SessionContext.Provider>;
}

/** Signs the user out of this device. Outside a provider it does nothing, so a screen renders on its own. */
export function useSignOut(): SignOut {
  return useContext(SessionContext);
}
