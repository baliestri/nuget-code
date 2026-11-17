/** Days of use before the user is first asked to rate the extension. */
export const RATING_FIRST_ASK_DAYS = 5;

/** Days of use between one asking for a rating and the next, when the user answered "Later". */
export const RATING_DAYS_BETWEEN_ASKS = 14;

/** How many times the user is asked for a rating at most. */
export const RATING_MAX_ASKS = 3;

/** Days of use before the user is asked, once, to star the repository. */
export const STAR_ASK_DAYS = 15;

/** How much the extension was used; shared by every notification. */
export interface UsageState {
  /** The distinct days on which the extension was activated. */
  activeDays: number;
  /** The last of those days, as `YYYY-MM-DD` in local time; empty before the first. */
  lastActiveDay: string;
}

/** What is remembered about asking for a rating. */
export interface RatingState {
  /** How many times the user was asked. */
  asks: number;
  /** The days of use when the user was last asked; 0 before the first asking. */
  activeDaysAtLastAsk: number;
  /** True once the user rated, declined for good, or was asked `RATING_MAX_ASKS` times. */
  done: boolean;
}

/** What is remembered about asking for a star; the user is asked once, whatever the answer. */
export interface StarState {
  done: boolean;
}

export const INITIAL_USAGE_STATE: UsageState = { activeDays: 0, lastActiveDay: "" };
export const INITIAL_RATING_STATE: RatingState = { asks: 0, activeDaysAtLastAsk: 0, done: false };
export const INITIAL_STAR_STATE: StarState = { done: false };

/** What the user did with the rating notification. Closing it counts as "later". */
export type RatingChoice = "rate" | "later" | "never";

/** The notification that may be shown in a session; at most one is. */
export type Prompt = "rating" | "star";

/** The store the editor installs extensions from. */
export type Store = "marketplace" | "openVsx";

/** Reads stored usage, starting over from what is missing or of the wrong type. */
export function readUsageState(value: unknown): UsageState {
  const stored = fields<UsageState>(value);
  return {
    activeDays: count(stored.activeDays),
    lastActiveDay: typeof stored.lastActiveDay === "string" ? stored.lastActiveDay : ""
  };
}

/** Reads a stored rating state, starting over from what is missing or of the wrong type. */
export function readRatingState(value: unknown): RatingState {
  const stored = fields<RatingState>(value);
  return {
    asks: count(stored.asks),
    activeDaysAtLastAsk: count(stored.activeDaysAtLastAsk),
    done: stored.done === true
  };
}

/** Reads a stored star state, starting over from what is missing or of the wrong type. */
export function readStarState(value: unknown): StarState {
  return { done: fields<StarState>(value).done === true };
}

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
export function dayOf(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, "0");
  const day = String(moment.getDate()).padStart(2, "0");
  return `${moment.getFullYear()}-${month}-${day}`;
}

/** Counts a day of use; a day already counted, in this window or another, is not counted again. */
export function recordActiveDay(usage: UsageState, day: string): UsageState {
  return usage.lastActiveDay === day ? usage : { activeDays: usage.activeDays + 1, lastActiveDay: day };
}

/** Whether the user may be asked for a rating now. */
export function shouldAskRating(usage: UsageState, rating: RatingState): boolean {
  if (rating.done) {
    return false;
  }

  return rating.asks === 0
    ? usage.activeDays >= RATING_FIRST_ASK_DAYS
    : usage.activeDays - rating.activeDaysAtLastAsk >= RATING_DAYS_BETWEEN_ASKS;
}

/** The rating state once the user is being asked; it is saved before the notification shows. */
export function recordRatingAsk(usage: UsageState, rating: RatingState): RatingState {
  return { ...rating, asks: rating.asks + 1, activeDaysAtLastAsk: usage.activeDays };
}

/** The rating state after the user's answer. */
export function recordRatingChoice(rating: RatingState, choice: RatingChoice): RatingState {
  return { ...rating, done: choice !== "later" || rating.asks >= RATING_MAX_ASKS };
}

/** Whether the user may be asked for a star now. */
export function shouldAskStar(usage: UsageState, star: StarState): boolean {
  return !star.done && usage.activeDays >= STAR_ASK_DAYS;
}

/** The notification to show in this session, if any; the rating goes first when both are due. */
export function nextPrompt(usage: UsageState, rating: RatingState, star: StarState): Prompt | undefined {
  if (shouldAskRating(usage, rating)) {
    return "rating";
  }

  return shouldAskStar(usage, star) ? "star" : undefined;
}

/** Microsoft's builds of Visual Studio Code install from the Marketplace; every other editor, from Open VSX. */
export function storeOf(appName: string): Store {
  return appName.startsWith("Visual Studio Code") ? "marketplace" : "openVsx";
}

export function storeName(store: Store): string {
  return store === "marketplace" ? "the Visual Studio Marketplace" : "Open VSX";
}

/** The page of the store where the extension is rated. */
export function reviewUrl(store: Store, publisher: string, name: string): string {
  return store === "marketplace"
    ? `https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}&ssr=false#review-details`
    : `https://open-vsx.org/extension/${publisher}/${name}/reviews`;
}

/**
 * The web page of the repository named by the `repository` field of a manifest, as a string or as
 * `{ url }`; `undefined` when it is missing or not an HTTPS address.
 */
export function repositoryUrl(repository: unknown): string | undefined {
  const url =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" && repository !== null && "url" in repository
        ? repository.url
        : undefined;
  if (typeof url !== "string") {
    return undefined;
  }

  const page = url.replace(/^git\+/u, "").replace(/\.git$/u, "");
  return page.startsWith("https://") ? page : undefined;
}

function fields<T>(value: unknown): Partial<Record<keyof T, unknown>> {
  return typeof value === "object" && value !== null ? (value as Partial<Record<keyof T, unknown>>) : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
