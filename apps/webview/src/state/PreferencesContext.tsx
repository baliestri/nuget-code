import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import {
  loadPreferences,
  preferencesReducer,
  type LogPreferences,
  type Preferences,
  type PreferencesAction
} from "./preferences";

/** Where the preferences are kept between reloads of the page: the webview's own state in the editor. */
export interface StateStorage {
  get(): unknown;
  set(value: unknown): void;
}

interface PreferencesValue {
  preferences: Preferences;
  dispatch: Dispatch<PreferencesAction>;
}

const PreferencesContext = createContext<PreferencesValue | undefined>(undefined);

export function PreferencesProvider({ storage, children }: { storage: StateStorage; children: ReactNode }): ReactNode {
  const [preferences, dispatch] = useReducer(preferencesReducer, undefined, () => loadPreferences(storage.get()));
  useEffect(() => {
    storage.set(preferences);
  }, [storage, preferences]);
  const value = useMemo(() => ({ preferences, dispatch }), [preferences]);
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export function usePreferences(): {
  preferences: Preferences;
  set(patch: Partial<Omit<Preferences, "log">>): void;
  setLog(patch: Partial<LogPreferences>): void;
} {
  const value = useContext(PreferencesContext);
  if (value === undefined) {
    throw new Error("usePreferences needs a PreferencesProvider above it.");
  }

  const { preferences, dispatch } = value;
  return useMemo(
    () => ({
      preferences,
      set: (patch) => dispatch({ type: "set", patch }),
      setLog: (patch) => dispatch({ type: "setLog", patch })
    }),
    [preferences, dispatch]
  );
}
