import { expect, it } from "vitest";
import { retryDecision, retryAfterMilliseconds } from "./http-retry";
const base = {
  attempt: 0,
  status: 503,
  transientNetworkError: false,
  retryAfterMs: null,
  remainingMs: 90_000,
  random: () => 0.5,
};
it("bounds retries, respects Retry-After, and never retries authentication", () => {
  expect(retryDecision(base)).toEqual({ retry: true, delayMs: 500 });
  expect(retryDecision({ ...base, attempt: 1 })).toEqual({
    retry: true,
    delayMs: 1000,
  });
  for (const status of [401, 403, 404])
    expect(retryDecision({ ...base, status }).retry).toBe(false);
  expect(retryDecision({ ...base, attempt: 2 }).retry).toBe(false);
  expect(
    retryDecision({ ...base, status: 429, retryAfterMs: 120_000 }).retry,
  ).toBe(false);
  expect(retryDecision({ ...base, retryAfterMs: 2500 })).toEqual({
    retry: true,
    delayMs: 2500,
  });
  expect(retryDecision({ ...base, remainingMs: 500 }).retry).toBe(false);
  expect(
    retryDecision({ ...base, status: null, transientNetworkError: true }).retry,
  ).toBe(true);
  expect(
    retryDecision({ ...base, status: null, transientNetworkError: false })
      .retry,
  ).toBe(false);
});
it("parses Retry-After seconds or HTTP dates without treating malformed values as zero", () => {
  expect(retryAfterMilliseconds("2", 0)).toBe(2000);
  expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:03 GMT", 1000)).toBe(
    2000,
  );
  expect(retryAfterMilliseconds("nonsense", 0)).toBeNull();
});
