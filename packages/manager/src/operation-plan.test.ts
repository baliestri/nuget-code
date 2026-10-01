import { expect, it } from "vitest";
import { sameMutationIntent } from "./operation-plan";
import type { MutationPlan } from "#contracts";
it("compares destinations, versions and sources while recognizing a deduplicated central edit", () => {
  const step = {
    id: "s",
    kind: "package" as const,
    packageId: "Demo",
    action: "update" as const,
    projectPaths: ["/a"],
    version: "1.5.0",
    feedUrls: ["https://feed.test/"],
  };
  const original: MutationPlan = {
    id: "a",
    targetId: "target",
    contextRevision: "old",
    steps: [step, { ...step, id: "b", projectPaths: ["/b"] }],
  };
  const grouped: MutationPlan = {
    ...original,
    id: "new",
    contextRevision: "new",
    steps: [{ ...step, projectPaths: ["/b", "/a"] }],
  };
  expect(sameMutationIntent(original, grouped)).toBe(true);
  expect(
    sameMutationIntent(original, {
      ...grouped,
      steps: [{ ...grouped.steps[0]!, version: "2.0.0" }],
    }),
  ).toBe(false);
  expect(
    sameMutationIntent(original, {
      ...grouped,
      steps: [{ ...grouped.steps[0]!, feedUrls: ["https://other.test/"] }],
    }),
  ).toBe(false);
});
