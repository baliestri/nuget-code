import { describe, expect, it } from "vitest";
import { RestartPolicy } from "./restartPolicy";

function policyAt(clock: { now: number }): RestartPolicy {
  return new RestartPolicy(3, 60_000, () => clock.now);
}

function crashAt(policy: RestartPolicy, clock: { now: number }, seconds: number): boolean {
  clock.now = seconds * 1000;
  return policy.recordCrash();
}

describe("RestartPolicy", () => {
  it("allows restarts below the limit", () => {
    const clock = { now: 0 };
    const policy = policyAt(clock);

    expect([crashAt(policy, clock, 0), crashAt(policy, clock, 10)]).toEqual([true, true]);
  });

  it("refuses the third crash inside the window", () => {
    const clock = { now: 0 };
    const policy = policyAt(clock);

    expect([crashAt(policy, clock, 0), crashAt(policy, clock, 30), crashAt(policy, clock, 59)]).toEqual([
      true,
      true,
      false
    ]);
  });

  it("forgets crashes older than the window", () => {
    const clock = { now: 0 };
    const policy = policyAt(clock);

    expect([crashAt(policy, clock, 0), crashAt(policy, clock, 10), crashAt(policy, clock, 61)]).toEqual([
      true,
      true,
      true
    ]);
  });

  it("reset clears the count", () => {
    const clock = { now: 0 };
    const policy = policyAt(clock);
    crashAt(policy, clock, 0);
    crashAt(policy, clock, 1);

    policy.reset();

    expect([crashAt(policy, clock, 2), crashAt(policy, clock, 3)]).toEqual([true, true]);
  });
});
