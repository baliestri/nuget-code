import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ErrorCodes,
  FeedFailureKinds,
  LogContexts,
  LogLevels,
  Methods,
  OperationSteps,
  PackageChangeKinds,
  PlanWarningKinds,
  ProgressKinds,
  RestoreEngines,
  RestoreStates,
  VersionOriginKinds
} from "./index";

const backend = fileURLToPath(new URL("../../../backend/src/NuGet.VisualStudioCode/", import.meta.url));

/** The values of the `public const` members of a C# file of the backend. */
function constantsOf(relativePath: string): (string | number)[] {
  const source = readFileSync(backend + relativePath, "utf8");
  const values: (string | number)[] = [];
  for (const match of source.matchAll(/public const (string|int) \w+ = "?([^";]+)"?;/g)) {
    values.push(match[1] === "int" ? Number(match[2]) : match[2]!);
  }
  return values.toSorted();
}

function valuesOf(constants: Record<string, string | number>): (string | number)[] {
  return Object.values(constants).toSorted();
}

describe("the protocol constants match the backend", () => {
  it.each([
    ["Protocol/MethodNames.cs", Methods],
    ["Rpc/RpcErrorCodes.cs", ErrorCodes],
    ["Restore/RestoreEngineNames.cs", RestoreEngines],
    ["Restore/RestoreStates.cs", RestoreStates],
    ["Operations/OperationSteps.cs", OperationSteps],
    ["Operations/PlanWarningKinds.cs", PlanWarningKinds],
    ["Operations/PackageChangeKinds.cs", PackageChangeKinds],
    ["Logging/LogLevels.cs", LogLevels],
    ["Logging/LogContexts.cs", LogContexts],
    ["Feeds/ProgressKinds.cs", ProgressKinds],
    ["Feeds/FeedFailureKinds.cs", FeedFailureKinds],
    ["Projects/VersionOriginKinds.cs", VersionOriginKinds]
  ] as const)("%s", (file, constants) => {
    const expected = constantsOf(file);

    expect(expected.length).toBeGreaterThan(0);
    expect(valuesOf(constants)).toEqual(expected);
  });
});
