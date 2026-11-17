import { describe, expect, it } from "vitest";
import {
  dayOf,
  INITIAL_RATING_STATE,
  INITIAL_STAR_STATE,
  INITIAL_USAGE_STATE,
  nextPrompt,
  RATING_DAYS_BETWEEN_ASKS,
  RATING_FIRST_ASK_DAYS,
  RATING_MAX_ASKS,
  readRatingState,
  readStarState,
  readUsageState,
  recordActiveDay,
  recordRatingAsk,
  recordRatingChoice,
  repositoryUrl,
  reviewUrl,
  shouldAskRating,
  shouldAskStar,
  STAR_ASK_DAYS,
  storeOf,
  type RatingState,
  type UsageState
} from "./engagementPrompt";

/** The usage after a number of distinct days of use, starting from `usage`. */
function useFor(days: number, usage: UsageState = INITIAL_USAGE_STATE): UsageState {
  let next = usage;
  for (let index = 0; index < days; index++) next = recordActiveDay(next, `day-${next.activeDays + 1}`);
  return next;
}

describe("recordActiveDay", () => {
  it("counts a new day", () => {
    expect(recordActiveDay(INITIAL_USAGE_STATE, "2026-11-16")).toEqual({
      activeDays: 1,
      lastActiveDay: "2026-11-16"
    });
  });

  it("does not count the same day twice", () => {
    const once = recordActiveDay(INITIAL_USAGE_STATE, "2026-11-16");

    expect(recordActiveDay(once, "2026-11-16")).toBe(once);
  });

  it("counts days of use, not days of the calendar", () => {
    const usage = recordActiveDay(recordActiveDay(INITIAL_USAGE_STATE, "2026-01-01"), "2026-12-31");

    expect(usage.activeDays).toBe(2);
  });
});

describe("dayOf", () => {
  it("is the local calendar day", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayOf(new Date(2026, 10, 16, 0, 0))).toBe("2026-11-16");
  });
});

describe("shouldAskRating", () => {
  it(`waits for ${RATING_FIRST_ASK_DAYS} days of use`, () => {
    expect(shouldAskRating(useFor(RATING_FIRST_ASK_DAYS - 1), INITIAL_RATING_STATE)).toBe(false);
    expect(shouldAskRating(useFor(RATING_FIRST_ASK_DAYS), INITIAL_RATING_STATE)).toBe(true);
  });

  it(`asks again only after ${RATING_DAYS_BETWEEN_ASKS} more days of use`, () => {
    const usage = useFor(RATING_FIRST_ASK_DAYS);
    const later = recordRatingChoice(recordRatingAsk(usage, INITIAL_RATING_STATE), "later");

    expect(shouldAskRating(usage, later)).toBe(false);
    expect(shouldAskRating(useFor(RATING_DAYS_BETWEEN_ASKS - 1, usage), later)).toBe(false);
    expect(shouldAskRating(useFor(RATING_DAYS_BETWEEN_ASKS, usage), later)).toBe(true);
  });

  it("does not ask once done", () => {
    expect(shouldAskRating(useFor(100), { ...INITIAL_RATING_STATE, done: true })).toBe(false);
  });

  it("does not ask twice when the asking was recorded but not answered", () => {
    const usage = useFor(RATING_FIRST_ASK_DAYS);

    expect(shouldAskRating(usage, recordRatingAsk(usage, INITIAL_RATING_STATE))).toBe(false);
  });
});

describe("recordRatingChoice", () => {
  const usage = useFor(RATING_FIRST_ASK_DAYS);
  const asked = recordRatingAsk(usage, INITIAL_RATING_STATE);

  it.each(["rate", "never"] as const)("%s stops the asking", (choice) => {
    expect(recordRatingChoice(asked, choice).done).toBe(true);
  });

  it("later keeps it for another time", () => {
    expect(recordRatingChoice(asked, "later").done).toBe(false);
  });

  it(`stops after ${RATING_MAX_ASKS} askings answered with later`, () => {
    let current = usage;
    let rating: RatingState = INITIAL_RATING_STATE;
    let asks = 0;
    while (shouldAskRating(current, rating)) {
      asks++;
      rating = recordRatingChoice(recordRatingAsk(current, rating), "later");
      current = useFor(RATING_DAYS_BETWEEN_ASKS, current);
    }

    expect(asks).toBe(RATING_MAX_ASKS);
    expect(rating.done).toBe(true);
  });
});

describe("shouldAskStar", () => {
  it(`waits for ${STAR_ASK_DAYS} days of use`, () => {
    expect(shouldAskStar(useFor(STAR_ASK_DAYS - 1), INITIAL_STAR_STATE)).toBe(false);
    expect(shouldAskStar(useFor(STAR_ASK_DAYS), INITIAL_STAR_STATE)).toBe(true);
  });

  it("asks only once", () => {
    expect(shouldAskStar(useFor(100), { done: true })).toBe(false);
  });
});

describe("nextPrompt", () => {
  const ratingDone: RatingState = { ...INITIAL_RATING_STATE, done: true };

  it("shows nothing before any notification is due", () => {
    expect(nextPrompt(useFor(RATING_FIRST_ASK_DAYS - 1), INITIAL_RATING_STATE, INITIAL_STAR_STATE)).toBeUndefined();
  });

  it("shows the rating when only it is due", () => {
    expect(nextPrompt(useFor(RATING_FIRST_ASK_DAYS), INITIAL_RATING_STATE, INITIAL_STAR_STATE)).toBe("rating");
  });

  it("shows the star when only it is due", () => {
    expect(nextPrompt(useFor(STAR_ASK_DAYS), ratingDone, INITIAL_STAR_STATE)).toBe("star");
  });

  it("shows the rating first when both are due", () => {
    expect(nextPrompt(useFor(STAR_ASK_DAYS), INITIAL_RATING_STATE, INITIAL_STAR_STATE)).toBe("rating");
  });

  it("shows the star while the rating waits for its next turn", () => {
    const usage = useFor(RATING_FIRST_ASK_DAYS);
    const later = recordRatingChoice(recordRatingAsk(usage, INITIAL_RATING_STATE), "later");
    const atStar = useFor(STAR_ASK_DAYS - RATING_FIRST_ASK_DAYS, usage);

    expect(shouldAskRating(atStar, later)).toBe(false);
    expect(nextPrompt(atStar, later, INITIAL_STAR_STATE)).toBe("star");
  });

  it("shows nothing once both are done", () => {
    expect(nextPrompt(useFor(100), ratingDone, { done: true })).toBeUndefined();
  });
});

describe("reading the stored state", () => {
  it("starts over from nothing", () => {
    expect(readUsageState(undefined)).toEqual(INITIAL_USAGE_STATE);
    expect(readRatingState("nonsense")).toEqual(INITIAL_RATING_STATE);
    expect(readStarState(null)).toEqual(INITIAL_STAR_STATE);
  });

  it("keeps what was stored", () => {
    const usage: UsageState = { activeDays: 7, lastActiveDay: "2026-11-16" };
    const rating: RatingState = { asks: 1, activeDaysAtLastAsk: 5, done: true };

    expect(readUsageState(usage)).toEqual(usage);
    expect(readRatingState(rating)).toEqual(rating);
    expect(readStarState({ done: true })).toEqual({ done: true });
  });

  it("drops values of the wrong type", () => {
    expect(readUsageState({ activeDays: -1, lastActiveDay: 3 })).toEqual(INITIAL_USAGE_STATE);
    expect(readRatingState({ asks: 1.5, activeDaysAtLastAsk: "5", done: "yes" })).toEqual(INITIAL_RATING_STATE);
    expect(readStarState({ done: 1 })).toEqual(INITIAL_STAR_STATE);
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

describe("repositoryUrl", () => {
  it.each([
    [{ type: "git", url: "https://github.com/baliestri/nuget-code.git" }, "https://github.com/baliestri/nuget-code"],
    [{ url: "git+https://github.com/baliestri/nuget-code.git" }, "https://github.com/baliestri/nuget-code"],
    ["https://github.com/baliestri/nuget-code", "https://github.com/baliestri/nuget-code"]
  ])("%j is the page %s", (repository, expected) => {
    expect(repositoryUrl(repository)).toBe(expected);
  });

  it.each([undefined, null, 42, {}, { url: 3 }, "github:baliestri/nuget-code", { url: "git@github.com:a/b.git" }])(
    "%j has no page",
    (repository) => {
      expect(repositoryUrl(repository)).toBeUndefined();
    }
  );
});
