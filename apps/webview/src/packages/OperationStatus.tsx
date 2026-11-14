import { OperationSteps, type OperationStep } from "@nuget-code/protocol";
import type { ReactNode } from "react";
import { useBridge } from "../bridge/BridgeContext";
import { summarizeResult, useOperation } from "../state/operation";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { LinkButton } from "../ui/LinkButton";
import { Spinner } from "../ui/Spinner";

const STEPS: Record<OperationStep, string> = {
  [OperationSteps.planning]: "Planning the change…",
  [OperationSteps.editing]: "Editing the project files…",
  [OperationSteps.evaluating]: "Evaluating the projects…",
  [OperationSteps.restoring]: "Restoring packages…",
  [OperationSteps.done]: "Finishing…"
};

/** The line shown while an operation runs: what it is doing, and a way to cancel it. */
export function OperationBar(): ReactNode {
  const operation = useOperation();
  if (!operation.running) {
    return null;
  }

  return (
    <div className="border-border flex shrink-0 items-center gap-2 border-t px-2 py-1">
      <Spinner label="An operation is running" />
      <span className="min-w-0 flex-1 truncate">
        {operation.title}: {operation.step === undefined ? "Working…" : STEPS[operation.step]}
      </span>
      <Button variant="secondary" onClick={operation.cancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * How the last operation ended, when there is something to say: it failed, a restore failed, a file could
 * not be written, or it was cancelled. A plain success says nothing; what a change did beyond what was asked
 * is a notification of the editor, not part of the view.
 */
export function ResultBanner(): ReactNode {
  const bridge = useBridge();
  const { last, dismiss } = useOperation();
  if (last === undefined) {
    return null;
  }

  const showLog = <LinkButton onClick={() => void bridge.host("showLog", {}).catch(() => {})}>Show Log</LinkButton>;
  const close = <IconButton icon="close" label="Dismiss" onClick={dismiss} />;

  if (last.error !== undefined) {
    return (
      <Banner
        kind="error"
        actions={
          <>
            {showLog}
            {close}
          </>
        }
      >
        {last.title} could not run. {last.error.message}
      </Banner>
    );
  }

  const summary = last.result === undefined ? undefined : summarizeResult(last.result);
  const editErrors = last.result?.projects.flatMap((project) => project.editErrors) ?? [];
  const lines: string[] = [];
  if (summary !== undefined && summary.failed > 0) {
    lines.push(`Restore failed for ${summary.failed} of ${summary.total} projects. The edits were kept.`);
  }

  if (summary?.cancelled === true) {
    lines.push("The operation was cancelled. Files that were already edited stay edited.");
  }

  for (const error of editErrors) {
    lines.push(`Could not write ${error}`);
  }

  if (lines.length === 0) {
    return null;
  }

  const failed = summary !== undefined && (summary.failed > 0 || editErrors.length > 0);
  return (
    <Banner
      kind={failed ? "error" : "warning"}
      actions={
        <>
          {failed ? showLog : null}
          {close}
        </>
      }
    >
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Banner>
  );
}
