import * as vscode from "vscode";
import {
  dayOf,
  nextPrompt,
  readRatingState,
  readStarState,
  readUsageState,
  recordActiveDay,
  recordRatingAsk,
  recordRatingChoice,
  repositoryUrl,
  reviewUrl,
  storeName,
  storeOf,
  type RatingChoice
} from "./engagementPrompt";

const USAGE = "nuget.usage";
const RATING = "nuget.rating";
const STAR = "nuget.star";

/** How long after activation a notification waits, so it does not crowd the ones of the start. */
const DELAY_MS = 2 * 60 * 1000;

const RATE = "Rate";
const LATER = "Later";
const STAR_ON_GITHUB = "Star on GitHub";
const NEVER = "Don't Show Again";

interface Manifest {
  publisher: string;
  name: string;
  repository?: unknown;
}

/**
 * Counts today as a day of use and, when the time has come, asks the user to rate the extension or to
 * star its repository: one of the two at most per session. The state is global and synchronized, so an
 * answer holds on every machine.
 */
export function registerEngagementPrompts(context: vscode.ExtensionContext): vscode.Disposable {
  const state = context.globalState;
  state.setKeysForSync([USAGE, RATING, STAR]);

  const usage = recordActiveDay(readUsageState(state.get(USAGE)), dayOf(new Date()));
  void state.update(USAGE, usage);
  const due = nextPrompt(usage, readRatingState(state.get(RATING)), readStarState(state.get(STAR)));
  if (context.extensionMode !== vscode.ExtensionMode.Production || due === undefined) {
    return new vscode.Disposable(() => undefined);
  }

  const timer = setTimeout(() => void ask(context), DELAY_MS);
  return new vscode.Disposable(() => clearTimeout(timer));
}

async function ask(context: vscode.ExtensionContext): Promise<void> {
  // Another window may have asked meanwhile; each asking is recorded before it shows, for the same reason.
  const state = context.globalState;
  const usage = readUsageState(state.get(USAGE));
  const rating = readRatingState(state.get(RATING));
  const manifest = context.extension.packageJSON as Manifest;
  switch (nextPrompt(usage, rating, readStarState(state.get(STAR)))) {
    case "rating": {
      await state.update(RATING, recordRatingAsk(usage, rating));
      await askRating(context, manifest);
      return;
    }
    case "star": {
      await state.update(STAR, { done: true });
      await askStar(manifest);
      return;
    }
    case undefined:
      return;
  }
}

async function askRating(context: vscode.ExtensionContext, manifest: Manifest): Promise<void> {
  const store = storeOf(vscode.env.appName);
  const answer = await vscode.window.showInformationMessage(
    `Enjoying NuGet Manager for VS Code? A rating on ${storeName(store)} helps others find it.`,
    RATE,
    LATER,
    NEVER
  );

  const choice: RatingChoice = answer === RATE ? "rate" : answer === NEVER ? "never" : "later";
  await context.globalState.update(
    RATING,
    recordRatingChoice(readRatingState(context.globalState.get(RATING)), choice)
  );
  if (choice === "rate") {
    await openExternal(reviewUrl(store, manifest.publisher, manifest.name));
  }
}

async function askStar(manifest: Manifest): Promise<void> {
  const repository = repositoryUrl(manifest.repository);
  if (repository === undefined) {
    return;
  }

  const answer = await vscode.window.showInformationMessage(
    "Finding NuGet Manager for VS Code useful? A star on GitHub helps the project grow.",
    STAR_ON_GITHUB,
    NEVER
  );
  if (answer === STAR_ON_GITHUB) {
    await openExternal(repository);
  }
}

async function openExternal(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url, true));
}
