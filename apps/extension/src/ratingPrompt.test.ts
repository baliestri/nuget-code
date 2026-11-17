import { describe, expect, it } from "vitest";
import {
  ACTIVE_DAYS_BEFORE_FIRST_ASK,
  ACTIVE_DAYS_BETWEEN_ASKS,
  dayOf,
  INITIAL_RATING_STATE,
  MAX_ASKS,
  readRatingState,
  recordActiveDay,
  recordAsk,
  recordChoice,
  reviewUrl,
  shouldAsk,
  storeOf,
  type RatingState
} from "./ratingPrompt";

/** The state after a number of distinct days of use, starting from `state`. */
function useFor(days: number, state: RatingState = INITIAL_RATING_STATE): RatingState {
  let next = state;
  for (let index = 0; index < days; index++) next = recordActiveDay(next, `day-${next.activeDays + 1}`);
  return next;
}

describe("recordActiveDay", () => {
  it("counts a new day", () => {
    const state = recordActiveDay(INITIAL_RATING_STATE, "2026-11-16");

    expect(state).toEqual({ ...INITIAL_RATING_STATE, activeDays: 1, lastActiveDay: "2026-11-16" });
  });

  it("does not count the same day twice", () => {
    const once = recordActiveDay(INITIAL_RATING_STATE, "2026-11-16");

    expect(recordActiveDay(once, "2026-11-16")).toBe(once);
  });

  it("counts days of use, not days of the calendar", () => {
    const state = recordActiveDay(recordActiveDay(INITIAL_RATING_STATE, "2026-01-01"), "2026-12-31");

    expect(state.activeDays).toBe(2);
  });
});

describe("dayOf", () => {
  it("is the local calendar day", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayOf(new Date(2026, 10, 16, 0, 0))).toBe("2026-11-16");
  });
});

describe("shouldAsk", () => {
  it(`waits for ${ACTIVE_DAYS_BEFORE_FIRST_ASK} days of use`, () => {
    expect(shouldAsk(useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK - 1))).toBe(false);
    expect(shouldAsk(useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK))).toBe(true);
  });

  it(`asks again only after ${ACTIVE_DAYS_BETWEEN_ASKS} more days of use`, () => {
    const later = recordChoice(recordAsk(useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK)), "later");

    expect(shouldAsk(later)).toBe(false);
    expect(shouldAsk(useFor(ACTIVE_DAYS_BETWEEN_ASKS - 1, later))).toBe(false);
    expect(shouldAsk(useFor(ACTIVE_DAYS_BETWEEN_ASKS, later))).toBe(true);
  });

  it("does not ask once done", () => {
    expect(shouldAsk({ ...useFor(100), done: true })).toBe(false);
  });

  it("does not ask twice when the asking was recorded but not answered", () => {
    expect(shouldAsk(recordAsk(useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK)))).toBe(false);
  });
});

describe("recordChoice", () => {
  const asked = recordAsk(useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK));

  it.each(["rate", "never"] as const)("%s stops the asking", (choice) => {
    expect(recordChoice(asked, choice).done).toBe(true);
  });

  it("later keeps it for another time", () => {
    expect(recordChoice(asked, "later").done).toBe(false);
  });

  it(`stops after ${MAX_ASKS} askings answered with later`, () => {
    let state = useFor(ACTIVE_DAYS_BEFORE_FIRST_ASK);
    let asks = 0;
    while (shouldAsk(state)) {
      asks++;
      state = useFor(ACTIVE_DAYS_BETWEEN_ASKS, recordChoice(recordAsk(state), "later"));
    }

    expect(asks).toBe(MAX_ASKS);
    expect(state.done).toBe(true);
  });
});

describe("readRatingState", () => {
  it("starts over from nothing", () => {
    expect(readRatingState(undefined)).toEqual(INITIAL_RATING_STATE);
    expect(readRatingState("nonsense")).toEqual(INITIAL_RATING_STATE);
  });

  it("keeps what was stored", () => {
    const stored: RatingState = {
      activeDays: 7,
      lastActiveDay: "2026-11-16",
      asks: 1,
      activeDaysAtLastAsk: 5,
      done: true
    };

    expect(readRatingState(stored)).toEqual(stored);
  });

  it("drops values of the wrong type", () => {
    expect(
      readRatingState({ activeDays: -1, lastActiveDay: 3, asks: 1.5, activeDaysAtLastAsk: "5", done: "yes" })
    ).toEqual(INITIAL_RATING_STATE);
  });
});

describe("storeOf", () => {
  it.each(["Visual Studio Code", "Visual Studio Code - Insiders"])("%s rates on the Marketplace", (appName) => {
    expect(storeOf(appName)).toBe("marketplace");
  });

  it.each(["VSCodium", "VSCodium - Insiders", "Cursor", "Windsurf", "code-server", "Eclipse Theia"])(
    "%s rates on Open VSX",
    (appName) => {
      expect(storeOf(appName)).toBe("openVsx");
    }
  );
});

describe("reviewUrl", () => {
  it("points at the reviews of each store", () => {
    expect(reviewUrl("marketplace", "baliestri", "nuget-code")).toBe(
      "https://marketplace.visualstudio.com/items?itemName=baliestri.nuget-code&ssr=false#review-details"
    );
    expect(reviewUrl("openVsx", "baliestri", "nuget-code")).toBe(
      "https://open-vsx.org/extension/baliestri/nuget-code/reviews"
    );
  });
});
