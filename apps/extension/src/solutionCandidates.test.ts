import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  chooseAutomatically,
  toTarget,
  type CandidateInput,
  type SolutionCandidate
} from "./solutionCandidates";

function build(input: Partial<CandidateInput>): SolutionCandidate[] {
  return buildCandidates({
    folders: [{ name: "repo", path: "/work/repo" }],
    solutions: [],
    projects: [],
    platform: "linux",
    ...input
  });
}

function candidate(path: string): SolutionCandidate {
  return { path, kind: "solution", folder: "repo", label: path, description: path };
}

describe("buildCandidates", () => {
  it("a folder with solutions lists them and no implicit entry", () => {
    const candidates = build({
      solutions: ["/work/repo/B.sln", "/work/repo/src/A.slnx"],
      projects: ["/work/repo/src/App/App.csproj"]
    });

    expect(candidates.map((item) => [item.kind, item.label, item.description])).toEqual([
      ["solution", "B.sln", "B.sln"],
      ["solution", "A.slnx", "src/A.slnx"]
    ]);
  });

  it("a folder with projects and no solution becomes an implicit solution", () => {
    const candidates = build({ projects: ["/work/repo/Lib/Lib.fsproj", "/work/repo/App/App.csproj"] });

    expect(candidates).toEqual([
      {
        path: "/work/repo",
        kind: "implicit",
        folder: "repo",
        label: "repo",
        description: "2 projects, no solution file",
        projects: ["/work/repo/App/App.csproj", "/work/repo/Lib/Lib.fsproj"]
      }
    ]);
  });

  it("a folder with neither contributes nothing", () => {
    expect(build({})).toEqual([]);
  });

  it("build output and dependency folders are not looked into", () => {
    const candidates = build({
      solutions: ["/work/repo/node_modules/pkg/Pkg.sln", "/work/repo/App.sln"],
      projects: ["/work/repo/App/obj/Generated.csproj", "/work/repo/App/bin/Debug/Copy.csproj"]
    });

    expect(candidates.map((item) => item.label)).toEqual(["App.sln"]);
  });

  it("multi-root folders are grouped and ordered", () => {
    const candidates = build({
      folders: [
        { name: "web", path: "/work/web" },
        { name: "api", path: "/work/api" }
      ],
      solutions: ["/work/web/Web.sln", "/work/api/Z.sln", "/work/api/A.sln"]
    });

    expect(candidates.map((item) => [item.folder, item.label])).toEqual([
      ["api", "A.sln"],
      ["api", "Z.sln"],
      ["web", "Web.sln"]
    ]);
  });

  it("a file belongs to the deepest workspace folder that contains it", () => {
    const candidates = build({
      folders: [
        { name: "repo", path: "/work/repo" },
        { name: "tools", path: "/work/repo/tools" }
      ],
      solutions: ["/work/repo/tools/Tools.sln", "/work/repo/App.sln"]
    });

    expect(candidates.map((item) => [item.folder, item.description])).toEqual([
      ["repo", "App.sln"],
      ["tools", "Tools.sln"]
    ]);
  });

  it("Windows paths are understood", () => {
    const candidates = build({
      folders: [{ name: "repo", path: "C:\\Work\\Repo" }],
      solutions: ["c:\\work\\repo\\src\\App.sln"],
      platform: "win32"
    });

    expect(candidates.map((item) => item.description)).toEqual(["src/App.sln"]);
  });
});

describe("chooseAutomatically", () => {
  const three = [candidate("/a/A.sln"), candidate("/a/B.sln"), candidate("/a/C.sln")];

  it("the remembered solution wins when it still exists", () => {
    expect(chooseAutomatically(three, "/a/B.sln", "linux")).toBe(three[1]);
  });

  it("a remembered solution that is gone is ignored", () => {
    expect(chooseAutomatically(three, "/a/Gone.sln", "linux")).toBeUndefined();
    expect(chooseAutomatically([three[0]!], "/a/Gone.sln", "linux")).toBe(three[0]);
  });

  it("a single candidate is chosen", () => {
    expect(chooseAutomatically([three[2]!], undefined, "linux")).toBe(three[2]);
  });

  it("several candidates and nothing remembered choose nothing", () => {
    expect(chooseAutomatically(three, undefined, "linux")).toBeUndefined();
  });

  it("no candidates choose nothing", () => {
    expect(chooseAutomatically([], "/a/A.sln", "linux")).toBeUndefined();
  });

  it.each([
    ["win32", true],
    ["darwin", true],
    ["linux", false]
  ])("on %s the remembered path matches in another case: %s", (platform, matches) => {
    expect(chooseAutomatically(three, "/A/b.SLN", platform) === three[1]).toBe(matches);
  });
});

describe("toTarget", () => {
  it("a solution file is opened by its path", () => {
    expect(toTarget(candidate("/a/A.sln"))).toEqual({ path: "/a/A.sln" });
  });

  it("an implicit solution carries its projects", () => {
    const implicit: SolutionCandidate = { ...candidate("/a"), kind: "implicit", projects: ["/a/App.csproj"] };

    expect(toTarget(implicit)).toEqual({ path: "/a", projects: ["/a/App.csproj"] });
  });
});
