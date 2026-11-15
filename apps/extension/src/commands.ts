import * as vscode from "vscode";
import type { BackendSession } from "./backendSession";
import type { CredentialStore } from "./credentialStore";
import type { LogChannel } from "./logChannel";
import { summarizeRestore } from "./restoreSummary";
import { Commands } from "./statusBar";

/** `NuGet: Restore`: restores the open solution, with a notification that can cancel it. */
export async function restoreCommand(session: BackendSession, log: LogChannel): Promise<void> {
  if (session.state !== "ready" || session.solution.kind !== "open") {
    const choice = await vscode.window.showInformationMessage("NuGet: select a solution first.", "Select Solution");
    if (choice === "Select Solution") {
      await vscode.commands.executeCommand(Commands.selectSolution);
    }

    return;
  }

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "NuGet: restoring packages…", cancellable: true },
      (_progress, token) => {
        // The restore still answers after this, with its projects marked as cancelled.
        token.onCancellationRequested(() => void session.api.cancelOperation().catch(() => {}));
        return session.api.restore({ force: false });
      }
    );
    const summary = summarizeRestore(result);
    if (summary.kind === "succeeded") {
      vscode.window.setStatusBarMessage("NuGet: restore finished", 4000);
    } else if (summary.kind === "failed") {
      await offerLog(log, `NuGet: ${summary.failed} of ${summary.total} projects failed to restore.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.host("error", `Restore failed: ${message}`);
    await offerLog(log, `NuGet: the restore could not run. ${message}`);
  }
}

/** `NuGet: Clear Saved Credentials`: forgets them here and lets the backend ask again. */
export async function clearCredentialsCommand(session: BackendSession, credentials: CredentialStore): Promise<void> {
  await credentials.clear();
  if (session.state === "ready") {
    await session.api.resetCredentials({});
  }

  await vscode.window.showInformationMessage("NuGet: the saved credentials were cleared.");
}

async function offerLog(log: LogChannel, message: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, "Show Log");
  if (choice === "Show Log") {
    log.show();
  }
}
