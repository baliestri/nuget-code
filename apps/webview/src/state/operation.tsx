import { BridgeError } from "@nuget-code/bridge";
import { RestoreStates, type OperationResult, type OperationStep, type PackagesPlanResult } from "@nuget-code/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useBridge, useBridgeEvent } from "../bridge/BridgeContext";
import { describeWarning } from "../packages/warnings";

/** How the last operation ended. */
export interface OperationOutcome {
  /** What the operation was, for the message: "Update", "Install", "Remove", "Restore". */
  title: string;
  result?: OperationResult;
  error?: BridgeError;
}

interface OperationValue {
  running: boolean;
  /** The title of the operation that is running. */
  title: string | undefined;
  step: OperationStep | undefined;
  last: OperationOutcome | undefined;
  /**
   * Runs one operation. `plan` asks the backend what the change does, to notify its warnings afterwards; it
   * runs beside the action and never holds it back, and its failure is ignored. Returns false, running
   * nothing, when another operation is running.
   */
  run(
    title: string,
    action: () => Promise<OperationResult>,
    plan?: () => Promise<PackagesPlanResult>
  ): Promise<boolean>;
  cancel(): void;
  dismiss(): void;
}

const OperationContext = createContext<OperationValue | undefined>(undefined);

export interface ResultSummary {
  total: number;
  failed: number;
  editErrors: number;
  cancelled: boolean;
}

export function summarizeResult(result: OperationResult): ResultSummary {
  return {
    total: result.projects.length,
    failed: result.projects.filter((project) => project.restore === RestoreStates.failed).length,
    editErrors: result.projects.filter((project) => project.editErrors.length > 0).length,
    cancelled: result.projects.some((project) => project.restore === RestoreStates.cancelled)
  };
}

/** Keeps track of the one operation that may run at a time, for every part of the view. */
export function OperationProvider({ children }: { children: ReactNode }): ReactNode {
  const bridge = useBridge();
  const queries = useQueryClient();
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState<string>();
  const [step, setStep] = useState<OperationStep>();
  const [last, setLast] = useState<OperationOutcome>();

  useBridgeEvent("operationProgress", (progress) => setStep(progress.step));

  const run = useCallback<OperationValue["run"]>(
    async (name, action, plan) => {
      if (busy.current) {
        return false;
      }

      busy.current = true;
      setRunning(true);
      setTitle(name);
      setStep(undefined);
      setLast(undefined);
      const warnings =
        plan === undefined
          ? Promise.resolve([])
          : plan().then(
              (planned) => planned.warnings,
              () => []
            );
      try {
        const result = await action();
        setLast({ title: name, result });
        // What the change did beyond what was asked is the editor's to show, where it can be silenced.
        const messages = (await warnings).map(describeWarning);
        if (messages.length > 0) {
          void bridge.host("notifyWarnings", { title: name, messages }).catch(() => {});
        }
      } catch (error) {
        setLast({
          title: name,
          error:
            error instanceof BridgeError
              ? error
              : new BridgeError({ kind: "host", message: error instanceof Error ? error.message : String(error) })
        });
      } finally {
        busy.current = false;
        setRunning(false);
        setStep(undefined);
        // The backend also says when the solution changed; this covers an operation that changed nothing it
        // reports, such as a restore that only wrote the assets files.
        void queries.invalidateQueries({ queryKey: ["installed"] });
        void queries.invalidateQueries({ queryKey: ["updates"] });
        void queries.invalidateQueries({ queryKey: ["vulnerabilities"] });
      }

      return true;
    },
    [queries, bridge]
  );

  const value = useMemo<OperationValue>(
    () => ({
      running,
      title,
      step,
      last,
      run,
      cancel: () => void bridge.backend("cancelOperation", {}).catch(() => {}),
      dismiss: () => setLast(undefined)
    }),
    [running, title, step, last, run, bridge]
  );
  return <OperationContext value={value}>{children}</OperationContext>;
}

export function useOperation(): OperationValue {
  const value = useContext(OperationContext);
  if (value === undefined) {
    throw new Error("useOperation needs an OperationProvider above it.");
  }

  return value;
}
