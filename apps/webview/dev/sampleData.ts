import type { SessionState } from "@nuget-code/bridge";
import type { ProjectInfo } from "@nuget-code/protocol";
import type { FakeBridge } from "../test/fakeBridge";

const ROOT = "D:\\work\\sample-library";

function project(name: string, error?: string): ProjectInfo {
  return {
    name,
    path: `${ROOT}\\${name}\\${name}.csproj`,
    frameworks: ["net10.0"],
    centralPackageManagement: false,
    ...(error === undefined ? {} : { error })
  };
}

export const PROJECTS: readonly ProjectInfo[] = [
  project("SampleLibrary"),
  project("SampleLibrary.Examples"),
  project("SampleLibrary.Generators"),
  project("SampleLibrary.Generators.Tests"),
  project("SampleLibrary.Tests")
];

export const SESSION: SessionState = {
  backend: "ready",
  solution: { kind: "open", name: "SampleLibrary.slnx", path: `${ROOT}\\SampleLibrary.slnx`, projects: PROJECTS },
  hasSdk: true
};

/** Gives the fake bridge answers that look like a real solution. Each tab adds what it needs here. */
export function installSampleData(fake: FakeBridge): void {
  fake.host.pickFolder = () => Promise.resolve({ path: `${ROOT}\\packages` });
}
