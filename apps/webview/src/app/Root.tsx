import type { BridgeClient } from "@nuget-code/bridge";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BridgeProvider } from "../bridge/BridgeContext";
import { LogProvider } from "../log/LogStore";
import { OperationProvider } from "../state/operation";
import { PreferencesProvider, type StateStorage } from "../state/PreferencesContext";
import { App } from "./App";

/**
 * The view with everything it depends on: the bridge to the host, where its preferences are kept, and the
 * cache of what it fetched. The same component runs in the editor, in the tests and on the development page;
 * only the bridge and the storage differ.
 */
export function Root({ client, storage }: { client: BridgeClient; storage: StateStorage }): ReactNode {
  const [queries] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // The data changes when the solution does, and the view is told when that happens. Nothing is
          // refetched on a timer or on focus, and a failure is shown, not retried behind the user's back.
          queries: { staleTime: Number.POSITIVE_INFINITY, retry: false, refetchOnWindowFocus: false }
        }
      })
  );
  return (
    <QueryClientProvider client={queries}>
      <BridgeProvider client={client}>
        <PreferencesProvider storage={storage}>
          <OperationProvider>
            <LogProvider>
              <App />
            </LogProvider>
          </OperationProvider>
        </PreferencesProvider>
      </BridgeProvider>
    </QueryClientProvider>
  );
}
