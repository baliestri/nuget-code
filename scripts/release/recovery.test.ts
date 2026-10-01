import { expect, it } from "vitest";
import {
  classifyMarketplace,
  classifyOpenVsx,
  recoverySteps,
} from "./recovery.ts";

const prepared = {
  version: "2.0.0",
  sourceSha: "a".repeat(40),
  branch: "release/v2.0.0",
  tag: "v2.0.0",
};
const artifact = {
  version: "2.0.0",
  sourceSha: prepared.sourceSha,
  vsixName: "nuget-code-2.0.0.vsix",
  sha256: "b".repeat(64),
  runId: "123",
  runAttempt: 1,
};
const receipt = {
  version: prepared.version,
  sourceSha: prepared.sourceSha,
  sha256: artifact.sha256,
  runId: "123",
  runAttempt: 1,
};

it("resumes only pending steps after partial publication", () => {
  expect(
    recoverySteps({
      promoted: true,
      marketplace: "verified",
      openVsx: "verified",
      githubRelease: "absent",
      developContainsRelease: false,
    }),
  ).toEqual(["create-github-release", "sync"]);
  expect(
    recoverySteps({
      promoted: true,
      marketplace: "verified",
      openVsx: "verified",
      githubRelease: "verified",
      developContainsRelease: false,
    }),
  ).toEqual(["sync"]);
  expect(() =>
    recoverySteps({
      promoted: true,
      marketplace: "ambiguous",
      openVsx: "verified",
      githubRelease: "absent",
      developContainsRelease: false,
    }),
  ).toThrow();
  expect(() =>
    recoverySteps({
      promoted: false,
      marketplace: "verified",
      openVsx: "verified",
      githubRelease: "absent",
      developContainsRelease: false,
    }),
  ).toThrow();
});

it("requires Open VSX publication before GitHub Release and resumes it independently", () => {
  expect(
    recoverySteps({
      promoted: true,
      marketplace: "verified",
      openVsx: "absent",
      githubRelease: "absent",
      developContainsRelease: false,
    }),
  ).toEqual(["publish-openvsx", "create-github-release", "sync"]);
  expect(() =>
    recoverySteps({
      promoted: true,
      marketplace: "verified",
      openVsx: "absent",
      githubRelease: "verified",
      developContainsRelease: true,
    }),
  ).toThrow();
  expect(classifyOpenVsx(false, null, prepared, artifact)).toBe("absent");
  expect(classifyOpenVsx(true, null, prepared, artifact)).toBe("ambiguous");
  expect(classifyOpenVsx(true, receipt, prepared, artifact)).toBe("verified");
  expect(() => classifyOpenVsx(false, receipt, prepared, artifact)).toThrow();
});

it("requires a matching receipt and remote version for Marketplace verification", () => {
  expect(classifyMarketplace(false, null, prepared, artifact)).toBe("absent");
  expect(classifyMarketplace(true, null, prepared, artifact)).toBe("ambiguous");
  expect(classifyMarketplace(true, receipt, prepared, artifact)).toBe(
    "verified",
  );
  expect(() =>
    classifyMarketplace(
      true,
      { ...receipt, sha256: "c".repeat(64) },
      prepared,
      artifact,
    ),
  ).toThrow();
  expect(() =>
    classifyMarketplace(false, receipt, prepared, artifact),
  ).toThrow();
});
