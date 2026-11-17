import * as vscode from "vscode";
import {
  dayOf,
  readRatingState,
  recordActiveDay,
  recordAsk,
  recordChoice,
  reviewUrl,
  shouldAsk,
  storeName,
  storeOf,
  type RatingChoice,
  type RatingState
} from "./ratingPrompt";

const KEY = "nuget.rating";

/** How long after activation the notification waits, so it does not crowd the ones of the start. */
const DELAY_MS = 2 * 60 * 1000;

const RATE = "Rate";
const LATER = "Later";
const NEVER = "Don't Show Again";

/**
 * Counts today as a day of use and, when the time has come, asks the user to rate the extension once
 * during this session. The state is global and synchronized, so an answer holds on every machine.
 */
export function registerRatingPrompt(context: vscode.ExtensionContext): vscode.Disposable {
  context.globalState.setKeysForSync([KEY]);
  const read = (): RatingState => readRatingState(context.globalState.get(KEY));
  const write = (state: RatingState): Thenable<void> => context.globalState.update(KEY, state);

  const today = recordActiveDay(read(), dayOf(new Date()));
  void write(today);
  if (context.extensionMode !== vscode.ExtensionMode.Production || !shouldAsk(today)) {
    return new vscode.Disposable(() => undefined);
  }

  const timer = setTimeout(() => void ask(context, read, write), DELAY_MS);
  return new vscode.Disposable(() => clearTimeout(timer));
}

async function ask(
  context: vscode.ExtensionContext,
  read: () => RatingState,
  write: (state: RatingState) => Thenable<void>
): Promise<void> {
  // Another window may have asked meanwhile; the asking is recorded before it shows, for the same reason.
  const current = read();
  if (!shouldAsk(current)) {
    return;
  }

  await write(recordAsk(current));
  const store = storeOf(vscode.env.appName);
  const answer = await vscode.window.showInformationMessage(
    `Enjoying NuGet Manager for VS Code? A rating on ${storeName(store)} helps others find it.`,
    RATE,
    LATER,
    NEVER
  );

  const choice: RatingChoice = answer === RATE ? "rate" : answer === NEVER ? "never" : "later";
  await write(recordChoice(read(), choice));
  if (choice === "rate") {
    const { publisher, name } = context.extension.packageJSON as { publisher: string; name: string };
    await vscode.env.openExternal(vscode.Uri.parse(reviewUrl(store, publisher, name), true));
  }
}
