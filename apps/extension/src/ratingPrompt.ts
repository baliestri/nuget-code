/** Days of use before the user is first asked to rate the extension. */
export const ACTIVE_DAYS_BEFORE_FIRST_ASK = 5;

/** Days of use between one asking and the next, when the user answered "Later". */
export const ACTIVE_DAYS_BETWEEN_ASKS = 14;

/** How many times the user is asked at most; after that, the extension stops asking. */
export const MAX_ASKS = 3;

/** What is remembered between sessions about asking for a rating. */
export interface RatingState {
  /** The distinct days on which the extension was activated. */
  activeDays: number;
  /** The last of those days, as `YYYY-MM-DD` in local time; empty before the first. */
  lastActiveDay: string;
  /** How many times the user was asked. */
  asks: number;
  /** The value of `activeDays` when the user was last asked; 0 before the first asking. */
  activeDaysAtLastAsk: number;
  /** True once the user rated, declined for good, or was asked `MAX_ASKS` times. */
  done: boolean;
}

export const INITIAL_RATING_STATE: RatingState = {
  activeDays: 0,
  lastActiveDay: "",
  asks: 0,
  activeDaysAtLastAsk: 0,
  done: false
};

/** What the user did with the notification. Closing it counts as "later". */
export type RatingChoice = "rate" | "later" | "never";

/** The store the editor installs extensions from. */
export type Store = "marketplace" | "openVsx";

/** Reads a stored state, starting over from what is missing or of the wrong type. */
export function readRatingState(value: unknown): RatingState {
  if (typeof value !== "object" || value === null) {
    return INITIAL_RATING_STATE;
  }

  const stored = value as Partial<Record<keyof RatingState, unknown>>;
  return {
    activeDays: count(stored.activeDays),
    lastActiveDay: typeof stored.lastActiveDay === "string" ? stored.lastActiveDay : "",
    asks: count(stored.asks),
    activeDaysAtLastAsk: count(stored.activeDaysAtLastAsk),
    done: stored.done === true
  };
}

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
export function dayOf(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, "0");
  const day = String(moment.getDate()).padStart(2, "0");
  return `${moment.getFullYear()}-${month}-${day}`;
}

/** Counts a day of use; a day already counted, in this window or another, is not counted again. */
export function recordActiveDay(state: RatingState, day: string): RatingState {
  return state.lastActiveDay === day ? state : { ...state, activeDays: state.activeDays + 1, lastActiveDay: day };
}

/** Whether the user may be asked now. */
export function shouldAsk(state: RatingState): boolean {
  if (state.done) {
    return false;
  }

  return state.asks === 0
    ? state.activeDays >= ACTIVE_DAYS_BEFORE_FIRST_ASK
    : state.activeDays - state.activeDaysAtLastAsk >= ACTIVE_DAYS_BETWEEN_ASKS;
}

/** The state once the user is being asked; it is saved before the notification shows. */
export function recordAsk(state: RatingState): RatingState {
  return { ...state, asks: state.asks + 1, activeDaysAtLastAsk: state.activeDays };
}

/** The state after the user's answer. */
export function recordChoice(state: RatingState, choice: RatingChoice): RatingState {
  const done = choice !== "later" || state.asks >= MAX_ASKS;
  return { ...state, done };
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

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
