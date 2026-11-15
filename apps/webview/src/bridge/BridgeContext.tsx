import type { BridgeClient, BridgeEvent, BridgeEvents, SessionState } from "@nuget-code/bridge";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface BridgeValue {
  client: BridgeClient;
  /** `undefined` until the host has said what the state is. */
  session: SessionState | undefined;
}

const BridgeContext = createContext<BridgeValue | undefined>(undefined);

/** Gives the view its bridge to the host, and keeps the state of the session the host reports. */
export function BridgeProvider({ client, children }: { client: BridgeClient; children: ReactNode }): ReactNode {
  const [session, setSession] = useState<SessionState>();
  useEffect(() => {
    const subscription = client.on("session", setSession);
    // Only now can the host's first event be heard.
    client.ready();
    return () => subscription.dispose();
  }, [client]);

  return <BridgeContext value={{ client, session }}>{children}</BridgeContext>;
}

function useBridgeValue(): BridgeValue {
  const value = useContext(BridgeContext);
  if (value === undefined) {
    throw new Error("The bridge hooks need a BridgeProvider above them.");
  }

  return value;
}

export function useBridge(): BridgeClient {
  return useBridgeValue().client;
}

export function useSession(): SessionState | undefined {
  return useBridgeValue().session;
}

/** Calls the listener for each event of the kind, for as long as the component is mounted. */
export function useBridgeEvent<E extends BridgeEvent>(event: E, listener: (payload: BridgeEvents[E]) => void): void {
  const client = useBridge();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => {
    const subscription = client.on(event, (payload) => latest.current(payload));
    return () => subscription.dispose();
  }, [client, event]);
}
