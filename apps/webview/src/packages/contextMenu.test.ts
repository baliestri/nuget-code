import type { FeedInfo, PackageDetailsResult } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { isNuGetOrg, packageFolder, packageMenu, type PackageMenuInput } from "./contextMenu";
import type { PackageRow, PackageUse } from "./model";

function feed(name: string, source: string): FeedInfo {
  return {
    name,
    source,
    enabled: true,
    allowInsecureConnections: false,
    protocolVersion: 3,
    isLocal: false,
    disableTlsCertificateValidation: false,
    isMachineWide: false
  };
}

const FEEDS = [
  feed("nuget.org", "https://api.nuget.org/v3/index.json"),
  feed("private", "https://pkgs.example/v3/index.json")
];

function use(name: string, extra: Partial<PackageUse> = {}): PackageUse {
  return { path: `/work/${name}/${name}.csproj`, name, resolved: "1.0.0", restored: true, implicit: false, ...extra };
}

function row(extra: Partial<PackageRow> = {}): PackageRow {
  return {
    id: "Alpha",
    versions: ["1.0.0"],
    projects: [use("App")],
    implicit: false,
    restored: true,
    hasUpdate: false,
    ...extra
  };
}

const DETAILS: PackageDetailsResult = {
  id: "Alpha",
  versions: ["2.0.0", "1.0.0"],
  license: "MIT",
  licenseUrl: "https://licenses.nuget.org/MIT",
  projectUrl: "https://example.org/alpha",
  dependencyGroups: [],
  feed: "nuget.org",
  failures: []
};

function input(extra: Partial<PackageMenuInput> = {}): PackageMenuInput {
  return {
    id: "Alpha",
    row: row(),
    targetName: "Solution",
    details: DETAILS,
    feeds: FEEDS,
    globalPackagesFolder: "/home/me/.nuget/packages",
    busy: false,
    ...extra
  };
}

/** The labels of a menu, with `---` where a separator is. */
const labels = (menu: ReturnType<typeof packageMenu>): string[] =>
  menu.map((entry) => (entry.kind === "separator" ? "---" : entry.label));
const item = (menu: ReturnType<typeof packageMenu>, start: string) =>
  menu.find((entry) => entry.kind === "item" && entry.label.startsWith(start)) as
    | Extract<ReturnType<typeof packageMenu>[number], { kind: "item" }>
    | undefined;

describe("packageMenu", () => {
  it("an installed package with an update has every group, update first", () => {
    const menu = packageMenu(input({ row: row({ hasUpdate: true, latest: "2.0.0" }), targetName: "App" }));

    expect(labels(menu)).toEqual([
      "Update Alpha in App from 1.0.0 to 2.0.0",
      "Remove Alpha from App",
      "---",
      "Show 1.0.0 in File Explorer",
      "Show All Package Versions in File Explorer",
      "---",
      "Show Package on NuGet.Org",
      "Show Project Page",
      "Show License Page (MIT)",
      "Search Package with Google",
      "---",
      "Toggle NuGet Info Expander",
      "Toggle NuGet Dependencies Expander",
      "Copy Package Name to Clipboard"
    ]);
    expect(item(menu, "Update")?.action).toEqual({ kind: "update", id: "Alpha" });
  });

  it("without an update there is no update item, and remove counts the projects", () => {
    const menu = packageMenu(input({ row: row({ projects: [use("App"), use("Lib")] }) }));

    expect(labels(menu).slice(0, 2)).toEqual(["Remove Alpha from 2 projects", "---"]);
    expect(item(menu, "Remove")?.action).toEqual({
      kind: "remove",
      id: "Alpha",
      projects: ["/work/App/App.csproj", "/work/Lib/Lib.csproj"]
    });
  });

  it("a package that is not installed starts at the folders, with no version of its own to show", () => {
    const menu = packageMenu(input({ row: undefined }));

    expect(labels(menu).slice(0, 2)).toEqual(["Show All Package Versions in File Explorer", "---"]);
  });

  it("an implicit package cannot be removed", () => {
    const menu = packageMenu(input({ row: row({ implicit: true, projects: [use("App", { implicit: true })] }) }));

    expect(item(menu, "Remove")).toBeUndefined();
  });

  it("update and remove wait while an operation runs; the rest does not", () => {
    const menu = packageMenu(input({ row: row({ hasUpdate: true, latest: "2.0.0" }), busy: true }));

    expect(item(menu, "Update")?.disabled).toBe(true);
    expect(item(menu, "Remove")?.disabled).toBe(true);
    expect(item(menu, "Copy")?.disabled).toBeUndefined();
  });

  it("each restored version in use has its folder; one that is not restored has none", () => {
    const menu = packageMenu(
      input({
        row: row({
          projects: [
            use("App"),
            use("Lib", { resolved: "1.5.0" }),
            use("Old", { restored: false, resolved: undefined as never })
          ]
        })
      })
    );

    expect(item(menu, "Show 1.0.0")?.action).toEqual({
      kind: "openFolder",
      path: "/home/me/.nuget/packages/alpha/1.0.0"
    });
    expect(item(menu, "Show 1.5.0")).toBeDefined();
    expect(labels(menu).filter((label) => /^Show \d/.test(label))).toHaveLength(2);
  });

  it("there are no folder items until the global packages folder is known", () => {
    expect(labels(packageMenu(input({ globalPackagesFolder: undefined }))).join()).not.toContain("File Explorer");
  });

  it("the NuGet.Org item is only for a package that comes from nuget.org", () => {
    expect(item(packageMenu(input()), "Show Package on NuGet.Org")?.action).toEqual({
      kind: "openExternal",
      url: "https://www.nuget.org/packages/Alpha"
    });
    expect(item(packageMenu(input({ details: { ...DETAILS, feed: "private" } })), "Show Package on")).toBeUndefined();
    expect(
      item(packageMenu(input({ details: { ...DETAILS, feed: undefined as never } })), "Show Package on")
    ).toBeUndefined();
  });

  it("the project and licence pages are there only when the package has them", () => {
    const menu = packageMenu(
      input({ details: { ...DETAILS, projectUrl: undefined as never, licenseUrl: undefined as never } })
    );

    expect(item(menu, "Show Project Page")).toBeUndefined();
    expect(item(menu, "Show License Page")).toBeUndefined();
    expect(item(menu, "Search Package with Google")).toBeDefined();
  });

  it("a licence without a name is just the licence page", () => {
    const menu = packageMenu(input({ details: { ...DETAILS, license: undefined as never } }));

    expect(item(menu, "Show License Page")?.label).toBe("Show License Page");
  });

  it("while the details are on their way, their items are shown waiting", () => {
    const menu = packageMenu(input({ details: undefined }));

    for (const start of ["Show Package on NuGet.Org", "Show Project Page", "Show License Page"]) {
      expect(item(menu, start)?.disabled).toBe(true);
    }
  });

  it("the search item escapes the name", () => {
    expect(item(packageMenu(input({ id: "A&B" })), "Search")?.action).toEqual({
      kind: "openExternal",
      url: "https://www.google.com/search?q=A%26B%20NuGet"
    });
  });

  it("the last group has its shortcuts", () => {
    const menu = packageMenu(input());

    expect(item(menu, "Toggle NuGet Info")?.shortcut).toBe("Ctrl+I");
    expect(item(menu, "Toggle NuGet Dependencies")?.shortcut).toBe("Ctrl+D");
    expect(item(menu, "Copy")).toMatchObject({ shortcut: "Ctrl+C", action: { kind: "copy", text: "Alpha" } });
  });
});

describe("isNuGetOrg", () => {
  it.each([
    ["nuget.org", true],
    ["private", false],
    ["missing", false],
    [undefined, false]
  ])("the feed %s: %s", (name, expected) => {
    expect(isNuGetOrg(name, FEEDS)).toBe(expected);
  });

  it("goes by the server, not by the name of the feed", () => {
    expect(isNuGetOrg("mirror", [feed("mirror", "https://www.nuget.org/api/v2")])).toBe(true);
    expect(isNuGetOrg("nuget.org", [feed("nuget.org", "https://notnuget.org.example/v3")])).toBe(false);
    expect(isNuGetOrg("local", [feed("local", "C:\\feeds\\local")])).toBe(false);
  });
});

describe("packageFolder", () => {
  it("lower-cases the name and the version, as NuGet does on disk", () => {
    expect(packageFolder("/home/me/.nuget/packages/", "Newtonsoft.Json", "13.0.4-Beta1")).toBe(
      "/home/me/.nuget/packages/newtonsoft.json/13.0.4-beta1"
    );
  });

  it("uses the separator of the folder it is given", () => {
    expect(packageFolder("C:\\Users\\me\\.nuget\\packages\\", "Alpha")).toBe("C:\\Users\\me\\.nuget\\packages\\alpha");
  });
});
