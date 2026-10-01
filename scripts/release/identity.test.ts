import { expect, it } from "vitest";
import { assertPromotion, validatePreparedRelease } from "./identity.ts";

const sourceSha = "a".repeat(40);
const prepared = {
  version: "2.0.0",
  sourceSha,
  branch: "release/v2.0.0",
  tag: "v2.0.0",
};
it("rejects moved branches, changed gates, divergent main and conflicting tags", () => {
  expect(validatePreparedRelease(prepared)).toEqual(prepared);
  const valid = {
    prepared,
    checkedOutSha: sourceSha,
    branchSha: sourceSha,
    mainIsAncestor: true,
    tagSha: null,
    gateShas: [sourceSha, sourceSha],
  };
  expect(() => assertPromotion(valid)).not.toThrow();
  expect(() =>
    assertPromotion({ ...valid, branchSha: "b".repeat(40) }),
  ).toThrow();
  expect(() => assertPromotion({ ...valid, mainIsAncestor: false })).toThrow();
  expect(() => assertPromotion({ ...valid, tagSha: "b".repeat(40) })).toThrow();
  expect(() =>
    assertPromotion({ ...valid, gateShas: [sourceSha, "b".repeat(40)] }),
  ).toThrow();
});
