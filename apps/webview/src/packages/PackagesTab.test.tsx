import { BridgeError, type SessionState } from "@nuget-code/bridge";
import type {
  FeedInfo,
  InstalledPackage,
  OperationResult,
  PackageDetailsResult,
  PackagesInstalledResult,
  PackagesUpdatesResult,
  PackagesVulnerabilitiesResult,
  ProjectInfo
} from "@nuget-code/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFakeBridge, createMemoryStorage, type FakeBridge } from "../../test/fakeBridge";
import { Root } from "../app/Root";

const APP = "/work/App/App.csproj";
const LIB = "/work/Lib/Lib.csproj";
const PROJECTS: ProjectInfo[] = [
  { name: "App", path: APP, frameworks: ["net10.0"], centralPackageManagement: false },
  { name: "Lib", path: LIB, frameworks: ["net10.0"], centralPackageManagement: false }
];
const SESSION: SessionState = {
  backend: "ready",
  solution: { kind: "open", name: "Sample.slnx", path: "/work/Sample.slnx", projects: PROJECTS },
  hasSdk: true,
  audit: true
};

function pkg(id: string, version: string, extra: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id,
    requestedVersion: version,
    resolvedVersion: version,
    frameworks: ["net10.0"],
    implicit: false,
    restored: true,
    ...extra
  };
}

const INSTALLED: PackagesInstalledResult = {
  projects: [
    { projectPath: APP, packages: [pkg("Alpha", "1.0.0"), pkg("Beta", "2.0.0")], transitive: [] },
    { projectPath: LIB, packages: [pkg("Alpha", "1.0.0"), pkg("Gamma", "3.0.0")], transitive: [] }
  ]
};

const UPDATES: PackagesUpdatesResult = {
  packages: [
    { id: "Alpha", versions: [{ feed: "nuget.org", version: "1.5.0" }] },
    { id: "Beta", versions: [{ feed: "nuget.org", version: "2.0.0" }] },
    { id: "Gamma", versions: [{ feed: "nuget.org", version: "4.0.0" }] }
  ],
  failures: []
};

const FEED: FeedInfo = {
  name: "nuget.org",
  source: "https://api.nuget.org/v3/index.json",
  enabled: true,
  allowInsecureConnections: false,
  protocolVersion: 3,
  isLocal: false,
  disableTlsCertificateValidation: false,
  isMachineWide: false
};

function details(id: string, versions: string[]): PackageDetailsResult {
  return {
    id,
    versions,
    description: `${id} does things.`,
    authors: "The Authors",
    license: "MIT",
    licenseUrl: "https://licenses.nuget.org/MIT",
    projectUrl: `https://example.org/${id}`,
    dependencyGroups: [{ framework: "net10.0", dependencies: [{ id: "Delta", range: "[1.0.0, )" }] }],
    feed: "nuget.org",
    failures: [],
    vulnerableVersions: []
  };
}

function succeeded(projects: readonly string[]): OperationResult {
  return {
    engine: "embedded",
    fellBack: false,
    projects: projects.map((project) => ({
      project,
      changedFiles: [project],
      editErrors: [],
      restore: "succeeded",
      messages: []
    }))
  };
}

interface Setup {
  installed?: PackagesInstalledResult;
  updates?: PackagesUpdatesResult | Promise<PackagesUpdatesResult>;
  /** What the backend answers about the transitive packages. */
  transitiveUpdates?: PackagesUpdatesResult;
  /** What the backend knows about vulnerabilities; nothing, unless given. */
  vulnerabilities?: PackagesVulnerabilitiesResult;
  session?: SessionState;
  stored?: unknown;
  configure?(fake: FakeBridge): void;
}

function open(setup: Setup = {}) {
  const fake = createFakeBridge(setup.session ?? SESSION);
  fake.backend.installedPackages = () => Promise.resolve(setup.installed ?? INSTALLED);
  fake.backend.packageUpdates = (params) =>
    Promise.resolve(
      params.transitive === true
        ? (setup.transitiveUpdates ?? { packages: [], failures: [] })
        : (setup.updates ?? UPDATES)
    );
  fake.backend.packageVulnerabilities = () => Promise.resolve(setup.vulnerabilities ?? { packages: [], failures: [] });
  fake.backend.listSources = () =>
    Promise.resolve({ files: [], effective: [FEED], fallbackFolders: [], globalPackagesFolder: "/packages" });
  fake.backend.packageDetails = (params) => Promise.resolve(details(params.id, ["9.0.0", "1.5.0", "1.0.0"]));
  fake.backend.planPackages = () => Promise.resolve({ edits: [], warnings: [] });
  fake.backend.updatePackages = (params) =>
    Promise.resolve(succeeded(params.changes.flatMap((change) => change.projects)));
  fake.backend.installPackage = (params) => Promise.resolve(succeeded(params.projects));
  fake.backend.removePackage = (params) => Promise.resolve(succeeded(params.projects));
  fake.backend.restore = () => Promise.resolve(succeeded([APP, LIB]));
  fake.backend.cancelOperation = () => Promise.resolve({});
  setup.configure?.(fake);
  const storage = createMemoryStorage(setup.stored);
  render(<Root client={fake.client} storage={storage} />);
  return { fake, storage, user: userEvent.setup() };
}

const updateGroup = (): Promise<HTMLElement> => screen.findByRole("heading", { name: /^Packages to Update/ });

describe("Installed", () => {
  it("lists the installed packages with id and version, and the newer version on the right", async () => {
    open();

    expect(await screen.findByRole("heading", { name: "Installed Packages in Solution: 3" })).toBeInTheDocument();
    const installed = screen.getByRole("heading", { name: /^Installed Packages/ }).closest("section")!;
    expect(within(installed).getByRole("button", { name: "Alpha • 1.0.0" })).toBeInTheDocument();
    expect(within(installed).getByRole("button", { name: "Beta • 2.0.0" })).toBeInTheDocument();
    expect(
      within(within(installed).getByRole("button", { name: "Gamma • 3.0.0" }).closest("li")!).getByText("4.0.0")
    ).toBeInTheDocument();
  });

  it("the update group lists only the packages with an update, with its count", async () => {
    open();

    const group = (await updateGroup()).closest("section")!;
    expect(screen.getByRole("heading", { name: "Packages to Update in Solution: 2" })).toBeInTheDocument();
    expect(within(group).getAllByRole("listitem")).toHaveLength(2);
    expect(within(group).queryByRole("button", { name: /^Beta/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("2 with updates")).toBeInTheDocument();
  });

  it("there is no update group when nothing has an update", async () => {
    open({ updates: { packages: [], failures: [] } });

    await screen.findByRole("heading", { name: /^Installed Packages/ });
    expect(screen.queryByRole("heading", { name: /^Packages to Update/ })).not.toBeInTheDocument();
  });

  it("Update is enabled only with a selection, and sends one change per selected package", async () => {
    const { fake, user } = open();
    await updateGroup();
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /^Select all/ }));
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Gamma" })).toBeChecked();
    await user.click(update);

    await waitFor(() => expect(fake.callsOf("updatePackages")).toHaveLength(1));
    expect(fake.callsOf("updatePackages")[0]).toEqual({
      changes: [
        { kind: "update", id: "Alpha", version: "1.5.0", projects: [APP, LIB] },
        { kind: "update", id: "Gamma", version: "4.0.0", projects: [LIB] }
      ]
    });
  });

  it("ticking one package updates only that one", async () => {
    const { fake, user } = open();
    await updateGroup();

    await user.click(screen.getByRole("checkbox", { name: "Select Gamma" }));
    expect(screen.getByRole("checkbox", { name: /^Select all/ })).toBePartiallyChecked();
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(fake.callsOf("updatePackages")).toHaveLength(1));
    expect(fake.callsOf("updatePackages")[0]).toMatchObject({ changes: [{ id: "Gamma" }] });
  });

  it("a project target changes the titles and the rows", async () => {
    const { user } = open();
    await updateGroup();

    await user.click(screen.getByRole("combobox", { name: "Target" }));
    await user.click(screen.getByRole("option", { name: "App (2 packages)" }));

    expect(await screen.findByRole("heading", { name: "Installed Packages in App: 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Packages to Update in App: 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Gamma/ })).not.toBeInTheDocument();
  });

  it("the toolbar lists the solution and each project with its package count", async () => {
    const { user } = open();
    await updateGroup();

    await user.click(screen.getByRole("combobox", { name: "Target" }));

    const options = within(screen.getByRole("listbox", { name: "Target" })).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Solution", "App (2 packages)", "Lib (2 packages)"]);
    expect(options[0]!.querySelector("img")?.getAttribute("src")).toContain("sln.svg");
    expect(options[1]!.querySelector("img")?.getAttribute("src")).toContain("csproj.svg");
  });

  it("the target list works from the keyboard, and closes on Escape", async () => {
    const { user } = open();
    await updateGroup();
    const target = screen.getByRole("combobox", { name: "Target" });

    target.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(await screen.findByRole("heading", { name: "Installed Packages in Lib: 2" })).toBeInTheDocument();
    expect(target).toHaveTextContent("Lib");

    await user.keyboard("{ArrowDown}");
    expect(target).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(target).toHaveAttribute("aria-expanded", "false");
  });

  it("a project that failed to evaluate is disabled in the target list", async () => {
    const projects = [PROJECTS[0]!, { ...PROJECTS[1]!, error: "MSB4025: the project file could not be loaded." }];
    open({
      session: { ...SESSION, solution: { kind: "open", name: "Sample.slnx", path: "/work/Sample.slnx", projects } }
    });
    const user = userEvent.setup();
    await updateGroup();

    await user.click(screen.getByRole("combobox", { name: "Target" }));
    const lib = screen.getByRole("option", { name: /^Lib/ });
    expect(lib).toHaveAttribute("aria-disabled", "true");
    await user.click(lib);

    expect(screen.getByRole("heading", { name: /^Installed Packages in Solution/ })).toBeInTheDocument();
  });

  it("the search filters both groups", async () => {
    const { user } = open();
    await updateGroup();

    await user.type(screen.getByRole("searchbox", { name: "Search packages" }), "gam");

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Alpha/ })).not.toBeInTheDocument(), {
      timeout: 2000
    });
    expect(screen.getAllByRole("button", { name: /^Gamma/ })).toHaveLength(2);
  });

  it("implicit packages are dimmed and are never offered for update", async () => {
    open({
      installed: {
        projects: [{ projectPath: APP, packages: [pkg("Sdk.Implicit", "1.0.0", { implicit: true })], transitive: [] }]
      },
      updates: { packages: [{ id: "Sdk.Implicit", versions: [{ feed: "nuget.org", version: "2.0.0" }] }], failures: [] }
    });

    const row = await screen.findByRole("button", { name: /^Sdk\.Implicit/ });
    expect(row.className).toContain("opacity-60");
    expect(screen.queryByRole("heading", { name: /^Packages to Update/ })).not.toBeInTheDocument();
  });

  it("a package that is not restored shows a warning with a reason", async () => {
    open({
      installed: {
        projects: [
          {
            projectPath: APP,
            transitive: [],
            packages: [pkg("Alpha", "1.0.0", { restored: false, resolvedVersion: undefined as never })]
          }
        ]
      }
    });

    expect(await screen.findByRole("img", { name: /^Not restored in App/ })).toBeInTheDocument();
  });

  it("the headers spin while the updates load", async () => {
    open({ updates: new Promise(() => {}) });

    expect(await screen.findByRole("status", { name: /^Loading: Installed Packages/ })).toBeInTheDocument();
  });

  it("a click on the title of a group collapses it, and another expands it", async () => {
    const { user } = open();
    await updateGroup();
    const title = screen.getByRole("button", { name: /^Packages to Update in Solution/ });
    expect(title).toHaveAttribute("aria-expanded", "true");

    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Select Alpha" })).not.toBeInTheDocument();

    await user.click(title);
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeInTheDocument();
  });

  it("the installed group collapses by its title too", async () => {
    const { user } = open();
    await updateGroup();

    await user.click(screen.getByRole("button", { name: /^Installed Packages in Solution/ }));

    expect(screen.queryByRole("button", { name: /^Beta/ })).not.toBeInTheDocument();
  });

  it("a feed failure is shown without hiding the list", async () => {
    open({
      updates: { ...UPDATES, failures: [{ feed: "private", kind: "unreachable", message: "The feed did not answer." }] }
    });

    expect(await screen.findByText("private: The feed did not answer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Installed Packages/ })).toBeInTheDocument();
  });

  it("Manage Feeds switches to the Sources tab", async () => {
    const { user } = open();
    await updateGroup();

    await user.click(screen.getByRole("combobox", { name: "Feed" }));
    await user.click(screen.getByRole("option", { name: "Manage Feeds…" }));

    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  });

  it("the list reloads after solution/didChange", async () => {
    const { fake } = open();
    await updateGroup();
    const before = fake.callsOf("installedPackages").length;

    fake.emit("solutionDidChange", { projects: [APP] });

    await waitFor(() => expect(fake.callsOf("installedPackages").length).toBeGreaterThan(before));
  });

  it("an error reading the installed packages is shown", async () => {
    open({
      configure: (fake) => {
        fake.backend.installedPackages = () =>
          Promise.reject(new BridgeError({ kind: "backend", code: 1003, message: "No solution is open." }));
      }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("No solution is open.");
  });
});

describe("Discover and details", () => {
  async function discover(setup: Setup = {}) {
    const opened = open({
      ...setup,
      configure: (fake) => {
        fake.backend.searchPackages = () =>
          Promise.resolve({
            packages: [
              { id: "Newton", version: "13.0.4", feed: "nuget.org" },
              { id: "Alpha", version: "1.5.0", feed: "nuget.org" }
            ],
            failures: []
          });
        setup.configure?.(fake);
      }
    });
    await opened.user.click(await screen.findByRole("tab", { name: "Discover" }));
    return opened;
  }

  it("searches with the text, the feed and prerelease, for the top 100", async () => {
    const { fake, user } = await discover();
    await screen.findByRole("heading", { name: "Available Packages: Top 100" });

    await user.click(screen.getByRole("checkbox", { name: "Prerelease" }));
    await user.type(screen.getByRole("searchbox", { name: "Search packages" }), "newt");

    await waitFor(
      () =>
        expect(fake.callsOf("searchPackages")).toContainEqual({ query: "newt", prerelease: true, skip: 0, take: 100 }),
      { timeout: 2000 }
    );
  });

  it("shows id and version of each result", async () => {
    await discover();

    const item = (await screen.findByRole("button", { name: "Newton" })).closest("li")!;
    expect(within(item).getByText("13.0.4")).toBeInTheDocument();
  });

  it("a failed search says so", async () => {
    await discover({
      configure: (fake) => {
        fake.backend.searchPackages = () =>
          Promise.reject(new BridgeError({ kind: "backend", code: 1005, message: "Feed unreachable." }));
      }
    });

    expect(await screen.findByText("The search failed")).toBeInTheDocument();
    expect(screen.getByText("Feed unreachable.")).toBeInTheDocument();
  });

  it("nothing selected shows the empty state", async () => {
    open();

    expect(await screen.findByText("No package selected")).toBeInTheDocument();
  });

  it("selecting a package shows its details, with the versions newest first", async () => {
    const { user } = await discover();

    await user.click(await screen.findByRole("button", { name: "Newton" }));

    const details = screen.getByRole("region", { name: "Details" });
    expect(await within(details).findByRole("heading", { name: "Newton" })).toBeInTheDocument();
    const versions = within(await within(details).findByRole("combobox", { name: "Version" })).getAllByRole("option");
    expect(versions.map((option) => option.textContent)).toEqual(["9.0.0", "1.5.0", "1.0.0"]);
    expect(within(details).getByRole("combobox", { name: "Version" })).toHaveValue("9.0.0");
  });

  it("Info shows the description, the authors and links that open outside", async () => {
    const { fake, user } = await discover();
    await user.click(await screen.findByRole("button", { name: "Newton" }));

    await user.click(await screen.findByRole("button", { name: "Info" }));
    expect(screen.getByText("The Authors")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "MIT" }));
    await user.click(screen.getByRole("button", { name: "https://example.org/Newton" }));

    await waitFor(() =>
      expect(fake.callsOf("openExternal")).toEqual([
        { url: "https://licenses.nuget.org/MIT" },
        { url: "https://example.org/Newton" }
      ])
    );
  });

  it("Frameworks and Dependencies lists each group", async () => {
    const { user } = await discover();
    await user.click(await screen.findByRole("button", { name: "Newton" }));

    await user.click(await screen.findByRole("button", { name: "Frameworks and Dependencies" }));

    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.getByText("[1.0.0, )")).toBeInTheDocument();
  });

  it("a project without the package offers install; the header installs into all of them", async () => {
    const { fake, user } = await discover();
    await user.click(await screen.findByRole("button", { name: "Newton" }));

    await user.click(await screen.findByRole("button", { name: "Install in Lib" }));
    await waitFor(() =>
      expect(fake.callsOf("installPackage")).toEqual([{ id: "Newton", version: "9.0.0", projects: [LIB] }])
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install in every project that does not have it" })).toBeEnabled()
    );
    await user.click(screen.getByRole("button", { name: "Install in every project that does not have it" }));

    await waitFor(() =>
      expect(fake.callsOf("installPackage")[1]).toEqual({ id: "Newton", version: "9.0.0", projects: [APP, LIB] })
    );
  });

  it("a project with the package offers update to the selected version, and remove", async () => {
    const { fake, user } = open();
    await user.click((await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!);
    const projects = await screen.findByRole("list", { name: "Projects" });
    expect(within(projects).getAllByText("1.0.0")).toHaveLength(2);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Version" }), "1.5.0");
    await user.click(screen.getByRole("button", { name: "Change to this version in App" }));
    await waitFor(() =>
      expect(fake.callsOf("updatePackages")).toEqual([
        { changes: [{ kind: "update", id: "Alpha", version: "1.5.0", projects: [APP] }] }
      ])
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove from Lib" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Remove from Lib" }));

    await waitFor(() => expect(fake.callsOf("removePackage")).toEqual([{ id: "Alpha", projects: [LIB] }]));
  });

  it("update is disabled when the selected version is the installed one", async () => {
    const { user } = open();
    await user.click((await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Version" }), "1.0.0");

    expect(screen.getByRole("button", { name: "Change to this version in App" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove from App" })).toBeEnabled();
  });

  it("with a project target only that project is listed", async () => {
    const { user } = open({ stored: { target: APP } });
    await user.click((await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!);

    const projects = await screen.findByRole("list", { name: "Projects" });
    expect(within(projects).getAllByRole("listitem")).toHaveLength(1);
  });

  it("a package no feed knows shows a notice, and remove still works", async () => {
    const { fake, user } = open({
      configure: (bridge) => {
        bridge.backend.packageDetails = (params) => Promise.resolve({ ...details(params.id, []), failures: [] });
      }
    });
    await user.click((await screen.findAllByRole("button", { name: /^Beta/ }))[0]!);

    expect(await screen.findByText(/No enabled feed has this package/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Version" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove from App" }));

    await waitFor(() => expect(fake.callsOf("removePackage")).toEqual([{ id: "Beta", projects: [APP] }]));
  });

  it("the details reload when another package is selected", async () => {
    const { user } = open();
    await user.click((await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!);
    await screen.findByRole("heading", { name: "Alpha" });

    await user.click(screen.getAllByRole("button", { name: /^Gamma/ })[0]!);

    expect(await screen.findByRole("heading", { name: "Gamma" })).toBeInTheDocument();
  });
});

describe("operations", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function startUpdate(setup: Setup = {}) {
    const pending = deferred<OperationResult>();
    const opened = open({
      ...setup,
      configure: (fake) => {
        fake.backend.updatePackages = () => pending.promise;
        setup.configure?.(fake);
      }
    });
    await updateGroup();
    await opened.user.click(screen.getByRole("checkbox", { name: "Select Gamma" }));
    await opened.user.click(screen.getByRole("button", { name: "Update" }));
    return { ...opened, pending };
  }

  it("while it runs, the step is shown, Cancel is offered and actions are disabled", async () => {
    const { fake, user, pending } = await startUpdate();

    expect(await screen.findByRole("status", { name: "An operation is running" })).toBeInTheDocument();
    fake.emit("operationProgress", { step: "restoring" });
    expect(await screen.findByText("Update: Restoring packages…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(fake.callsOf("cancelOperation")).toHaveLength(1));

    pending.resolve(succeeded([LIB]));
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "An operation is running" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
  });

  it("a second operation is not started while one runs", async () => {
    const { fake, pending } = await startUpdate();
    await screen.findByRole("status", { name: "An operation is running" });

    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    pending.resolve(succeeded([LIB]));

    await waitFor(() => expect(fake.callsOf("updatePackages")).toHaveLength(1));
  });

  it("a plain success says nothing", async () => {
    const { pending } = await startUpdate();

    pending.resolve(succeeded([LIB]));

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "An operation is running" })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed restore shows the count, says the edits were kept and offers the log", async () => {
    const { fake, user, pending } = await startUpdate();

    pending.resolve({
      engine: "embedded",
      fellBack: false,
      projects: [
        { project: APP, changedFiles: [APP], editErrors: [], restore: "succeeded", messages: [] },
        {
          project: LIB,
          changedFiles: [LIB],
          editErrors: [],
          restore: "failed",
          messages: [{ level: "error", code: "NU1102", message: "x" }]
        }
      ]
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restore failed for 1 of 2 projects. The edits were kept."
    );
    await user.click(screen.getByRole("button", { name: "Show Log" }));
    await waitFor(() => expect(fake.callsOf("showLog")).toHaveLength(1));
  });

  it("plan warnings go to the editor as a notification, not into the view", async () => {
    const { fake, pending } = await startUpdate({
      configure: (fake) => {
        fake.backend.planPackages = () =>
          Promise.resolve({
            edits: [],
            warnings: [{ kind: "downgrade", packageId: "Gamma", projects: [], packages: [], detail: "5.0.0" }]
          });
      }
    });

    pending.resolve(succeeded([LIB]));

    await waitFor(() =>
      expect(fake.callsOf("notifyWarnings")).toEqual([
        { title: "Update", messages: ["Gamma: this is a downgrade from 5.0.0."] }
      ])
    );
    expect(screen.queryByText(/downgrade/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a plan that fails does not affect the operation", async () => {
    const { fake, pending } = await startUpdate({
      configure: (bridge) => {
        bridge.backend.planPackages = () =>
          Promise.reject(new BridgeError({ kind: "backend", code: 1104, message: "no" }));
      }
    });

    pending.resolve(succeeded([LIB]));

    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "An operation is running" })).not.toBeInTheDocument()
    );
    expect(fake.callsOf("updatePackages")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("edit errors are reported", async () => {
    const { pending } = await startUpdate();

    pending.resolve({
      fellBack: false,
      projects: [
        {
          project: LIB,
          changedFiles: [],
          editErrors: ["/work/Lib/Lib.csproj: The file is read-only."],
          restore: "notRun",
          messages: []
        }
      ]
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not write /work/Lib/Lib.csproj: The file is read-only."
    );
  });

  it("a cancelled operation says the edits stay", async () => {
    const { pending } = await startUpdate();

    pending.resolve({
      engine: "embedded",
      fellBack: false,
      projects: [{ project: LIB, changedFiles: [LIB], editErrors: [], restore: "cancelled", messages: [] }]
    });

    expect(await screen.findByText(/The operation was cancelled/)).toBeInTheDocument();
  });

  it("a request error is shown, and the list is not left disabled", async () => {
    const { pending } = await startUpdate();

    pending.reject(
      new BridgeError({ kind: "backend", code: 1101, message: "The project is not part of the open solution." })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Update could not run. The project is not part of the open solution."
    );
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeEnabled();
  });
});

describe("transitive packages", () => {
  const inner = (version: string, via: string[]) => ({
    id: "Inner",
    resolvedVersion: version,
    frameworks: ["net10.0"],
    via
  });
  const WITH_TRANSITIVE: PackagesInstalledResult = {
    projects: [
      {
        projectPath: APP,
        packages: [pkg("Alpha", "1.0.0")],
        transitive: [
          inner("1.0.0", ["Alpha"]),
          { id: "Deep", resolvedVersion: "4.0.0", frameworks: ["net10.0"], via: [] }
        ]
      },
      { projectPath: LIB, packages: [pkg("Alpha", "1.0.0")], transitive: [inner("1.2.0", ["Alpha"])] }
    ]
  };
  const TRANSITIVE_UPDATES: PackagesUpdatesResult = {
    packages: [
      { id: "Inner", versions: [{ feed: "nuget.org", version: "2.0.0" }] },
      { id: "Deep", versions: [{ feed: "nuget.org", version: "4.0.0" }] }
    ],
    failures: []
  };
  const group = (): Promise<HTMLElement> => screen.findByRole("heading", { name: /^Implicitly Installed Packages/ });
  const openTransitive = (setup: Setup = {}) =>
    open({ installed: WITH_TRANSITIVE, transitiveUpdates: TRANSITIVE_UPDATES, ...setup });

  it("the group is titled after Rider, with its count", async () => {
    openTransitive();

    expect((await group()).textContent).toBe("Implicitly Installed Packages in Solution: 2");
  });

  it("there is no group when nothing is transitive", async () => {
    const { fake } = open();
    await updateGroup();

    expect(screen.queryByRole("heading", { name: /^Implicitly Installed/ })).not.toBeInTheDocument();
    expect(fake.callsOf("packageUpdates")).not.toContainEqual(expect.objectContaining({ transitive: true }));
  });

  it("a line shows the versions in parentheses and the newest version on the right", async () => {
    openTransitive();
    const section = (await group()).closest("section")!;

    const line = (await within(section).findByRole("button", { name: "Inner • (1.0.0, 1.2.0)" })).closest("li")!;
    await waitFor(() => expect(within(line).getByText("2.0.0")).toBeInTheDocument());
    expect(within(section).getByRole("button", { name: "Deep • (4.0.0)" })).toBeInTheDocument();
  });

  it("the newest versions of transitive packages are asked for apart from the referenced ones", async () => {
    const { fake } = openTransitive();
    await group();

    await waitFor(() =>
      expect(fake.callsOf("packageUpdates")).toEqual(
        expect.arrayContaining([
          { prerelease: false, noCache: false },
          { prerelease: false, noCache: false, transitive: true }
        ])
      )
    );
  });

  it("a project target narrows the group to what that project has", async () => {
    const { user } = openTransitive();
    await group();

    await user.click(screen.getByRole("combobox", { name: "Target" }));
    await user.click(screen.getByRole("option", { name: /^Lib/ }));

    expect((await group()).textContent).toBe("Implicitly Installed Packages in Lib: 1");
    expect(screen.getByRole("button", { name: "Inner • (1.2.0)" })).toBeInTheDocument();
  });

  it("the search filters the group too", async () => {
    const { user } = openTransitive();
    await group();

    await user.type(screen.getByRole("searchbox", { name: "Search packages" }), "dee");

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Inner/ })).not.toBeInTheDocument(), {
      timeout: 2000
    });
    expect(screen.getByRole("button", { name: /^Deep/ })).toBeInTheDocument();
  });

  it("a project that has it transitively shows the version, via which package, and offers only Install", async () => {
    const { user } = openTransitive();
    await group();

    await user.click(screen.getByRole("button", { name: /^Inner/ }));

    const projects = await screen.findByRole("list", { name: "Projects" });
    const app = within(projects).getAllByRole("listitem")[0]!;
    expect(app).toHaveTextContent("App via Alpha");
    expect(app).toHaveTextContent("(1.0.0)");
    expect(within(app).getByRole("button", { name: "Install in App" })).toBeEnabled();
    expect(within(app).queryByRole("button", { name: /^(Change|Remove)/ })).not.toBeInTheDocument();
  });

  it("installing a transitive package makes it a reference of the project", async () => {
    const { fake, user } = openTransitive();
    await group();
    await user.click(screen.getByRole("button", { name: /^Inner/ }));

    await user.click(await screen.findByRole("button", { name: "Install in Lib" }));

    await waitFor(() =>
      expect(fake.callsOf("installPackage")).toEqual([{ id: "Inner", version: "9.0.0", projects: [LIB] }])
    );
  });

  it("the menu of a transitive package has its folders and no update or remove", async () => {
    const { user } = openTransitive();
    await group();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: /^Inner/ }) });

    const menu = screen.getByRole("menu", { name: "Actions for Inner" });
    expect(within(menu).queryByRole("menuitem", { name: /^(Update|Remove)/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Show 1.0.0 in File Explorer" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Show 1.2.0 in File Explorer" })).toBeInTheDocument();
  });

  it("Refresh asks again for the transitive versions too, without the cache", async () => {
    const { fake, user } = openTransitive();
    await group();

    await user.click(screen.getByRole("button", { name: "Refresh NuGet Packages and Clear the Caches" }));

    await waitFor(() =>
      expect(fake.callsOf("packageUpdates")).toContainEqual({ prerelease: false, noCache: true, transitive: true })
    );
  });
});

describe("known vulnerabilities", () => {
  const HIGH = { severity: "high" as const, url: "https://github.com/advisories/GHSA-high" };
  const LOW = { severity: "low" as const, url: "https://github.com/advisories/GHSA-low" };
  const INSTALLED_WITH_INNER: PackagesInstalledResult = {
    projects: [
      {
        projectPath: APP,
        packages: [pkg("Alpha", "1.0.0"), pkg("Beta", "2.0.0")],
        transitive: [
          { id: "Inner", resolvedVersion: "1.0.0", frameworks: ["net10.0"], via: ["Alpha"] },
          { id: "Aardvark", resolvedVersion: "1.0.0", frameworks: ["net10.0"], via: ["Alpha"] }
        ]
      }
    ]
  };
  const KNOWN: PackagesVulnerabilitiesResult = {
    packages: [
      { id: "Beta", version: "2.0.0", advisories: [LOW] },
      { id: "Inner", version: "1.0.0", advisories: [HIGH, LOW] }
    ],
    failures: []
  };
  const openVulnerable = (setup: Setup = {}) =>
    open({ installed: INSTALLED_WITH_INNER, vulnerabilities: KNOWN, ...setup });
  const shield = (name: RegExp): Promise<HTMLElement[]> => screen.findAllByRole("img", { name });

  it("a vulnerable package, referenced or transitive, shows a shield that says how many and how bad", async () => {
    openVulnerable();

    const beta = (await shield(/^1 known vulnerability \(low\)/))[0]!;
    const inner = (await shield(/^2 known vulnerabilities, the worst is high/))[0]!;
    expect(beta.closest("li")).toHaveTextContent("Beta");
    expect(inner.closest("li")).toHaveTextContent("Inner");
    expect(screen.getAllByRole("img", { name: /known vulnerabilit/ })).toHaveLength(2);
  });

  it("high and critical use the colour of an error, low and moderate the colour of a warning", async () => {
    openVulnerable();

    expect((await shield(/the worst is high/))[0]!.className).toContain("text-error");
    expect((await shield(/\(low\)/))[0]!.className).toContain("text-warning");
  });

  it("the Installed tab counts the vulnerable packages", async () => {
    openVulnerable();

    expect(await screen.findByLabelText("2 with known vulnerabilities")).toBeInTheDocument();
  });

  it("vulnerable packages come first in the smart order, and in their place in the alphabetical one", async () => {
    const { user } = openVulnerable();
    await shield(/the worst is high/);
    const names = (heading: RegExp): string[] =>
      within(screen.getByRole("heading", { name: heading }).closest("section")!)
        .getAllByRole("listitem")
        .map((item) => item.textContent.split(" ")[0]!);
    expect(names(/^Implicitly Installed/)).toEqual(["Inner", "Aardvark"]);
    expect(names(/^Installed Packages/)).toEqual(["Beta", "Alpha"]);

    await user.click(screen.getByRole("button", { name: /^Sort: Smart/ }));

    expect(names(/^Implicitly Installed/)).toEqual(["Aardvark", "Inner"]);
  });

  it("the details list each advisory of what is installed, worst first, and open it in the browser", async () => {
    const { fake, user } = openVulnerable();
    await shield(/the worst is high/);

    await user.click(screen.getByRole("button", { name: /^Inner/ }));

    const section = await screen.findByRole("region", { name: "Vulnerabilities" });
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([`high${HIGH.url}`, `low${LOW.url}`]);
    await user.click(within(section).getByRole("button", { name: HIGH.url }));
    await waitFor(() => expect(fake.callsOf("openExternal")).toEqual([{ url: HIGH.url }]));
  });

  it("a package without advisories has no such section", async () => {
    const { user } = openVulnerable();
    await shield(/the worst is high/);

    await user.click(screen.getAllByRole("button", { name: /^Alpha/ })[0]!);

    await screen.findByRole("heading", { name: "Alpha" });
    expect(screen.queryByRole("region", { name: "Vulnerabilities" })).not.toBeInTheDocument();
  });

  it("the version list marks the vulnerable versions, and they can still be installed", async () => {
    const { fake, user } = openVulnerable({
      configure: (bridge) => {
        bridge.backend.packageDetails = (params) =>
          Promise.resolve({
            ...details(params.id, ["2.0.0", "1.0.0"]),
            vulnerableVersions: [{ version: "1.0.0", severity: "high" }]
          });
      }
    });
    await shield(/the worst is high/);
    await user.click(screen.getByRole("button", { name: /^Inner/ }));

    const versions = within(await screen.findByRole("combobox", { name: "Version" })).getAllByRole("option");
    expect(versions.map((option) => option.textContent)).toEqual(["2.0.0", "1.0.0 — vulnerable (high)"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Version" }), "1.0.0");
    await user.click(screen.getByRole("button", { name: "Install in App" }));

    await waitFor(() =>
      expect(fake.callsOf("installPackage")).toEqual([{ id: "Inner", version: "1.0.0", projects: [APP] }])
    );
  });

  it("the menu offers each advisory of the installed version", async () => {
    const { fake, user } = openVulnerable();
    await shield(/the worst is high/);

    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: /^Inner/ }) });
    expect(screen.getByRole("menuitem", { name: "Show Advisory GHSA-low (low)" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Show Advisory GHSA-high (high)" }));

    await waitFor(() => expect(fake.callsOf("openExternal")).toEqual([{ url: HIGH.url }]));
  });

  it("Refresh asks for the vulnerabilities again, without the cache", async () => {
    const { fake, user } = openVulnerable();
    await shield(/the worst is high/);

    await user.click(screen.getByRole("button", { name: "Refresh NuGet Packages and Clear the Caches" }));

    await waitFor(() => expect(fake.callsOf("packageVulnerabilities")).toContainEqual({ noCache: true }));
  });

  it("a feed that failed to answer is shown with the other feed failures, once", async () => {
    const failure = { feed: "private", kind: "unreachable" as const, message: "The feed did not answer." };
    openVulnerable({
      vulnerabilities: { packages: [], failures: [failure] },
      updates: { ...UPDATES, failures: [failure] }
    });

    expect(await screen.findAllByText("private: The feed did not answer.")).toHaveLength(1);
  });

  it("with the audit off nothing is asked and nothing is shown", async () => {
    const { fake } = openVulnerable({ session: { ...SESSION, audit: false } });

    await screen.findByRole("heading", { name: /^Implicitly Installed/ });
    expect(screen.queryByRole("img", { name: /known vulnerabilit/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/with known vulnerabilities/)).not.toBeInTheDocument();
    expect(fake.callsOf("packageVulnerabilities")).toEqual([]);
  });
});

describe("the menu of a package", () => {
  const alpha = async (): Promise<HTMLElement> => (await screen.findAllByRole("button", { name: /^Alpha/ }))[0]!;
  const menuItem = (name: RegExp): HTMLElement => screen.getByRole("menuitem", { name });

  it("a right click opens it, selects the package and lists what can be done", async () => {
    const { user } = open();

    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    const menu = screen.getByRole("menu", { name: "Actions for Alpha" });
    expect(
      within(menu).getByRole("menuitem", { name: "Update Alpha in Solution from 1.0.0 to 1.5.0" })
    ).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove Alpha from 2 projects" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Copy Package Name to Clipboard" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeInTheDocument();
  });

  it("the update item updates the package in the target", async () => {
    const { fake, user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(menuItem(/^Update Alpha/));

    await waitFor(() =>
      expect(fake.callsOf("updatePackages")).toEqual([
        { changes: [{ kind: "update", id: "Alpha", version: "1.5.0", projects: [APP, LIB] }] }
      ])
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("the remove item removes it from the projects that have it", async () => {
    const { fake, user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(menuItem(/^Remove Alpha/));

    await waitFor(() => expect(fake.callsOf("removePackage")).toEqual([{ id: "Alpha", projects: [APP, LIB] }]));
  });

  it("a package without an update has no update item", async () => {
    const { user } = open();

    await user.pointer({ keys: "[MouseRight]", target: (await screen.findAllByRole("button", { name: /^Beta/ }))[0]! });

    expect(screen.queryByRole("menuitem", { name: /^Update/ })).not.toBeInTheDocument();
    expect(menuItem(/^Remove Beta from App/)).toBeInTheDocument();
  });

  it("the folder items open the folder of the package in the global packages folder", async () => {
    const { fake, user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(menuItem(/^Show 1\.0\.0 in File Explorer/));

    await waitFor(() => expect(fake.callsOf("openFolder")).toEqual([{ path: "/packages/alpha/1.0.0" }]));
  });

  it("a folder that could not be opened is told in a notification", async () => {
    const { fake, user } = open({
      configure: (bridge) => {
        bridge.host.openFolder = () =>
          Promise.reject(new BridgeError({ kind: "host", message: "The folder does not exist." }));
      }
    });
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(menuItem(/^Show All Package Versions/));

    await waitFor(() =>
      expect(fake.callsOf("notify")).toEqual([{ kind: "warning", messages: ["The folder does not exist."] }])
    );
  });

  it("the pages of the package open in the browser, and NuGet.Org only for a package from it", async () => {
    const { fake, user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(await screen.findByRole("menuitem", { name: "Show Project Page" }));
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });
    await user.click(await screen.findByRole("menuitem", { name: "Show Package on NuGet.Org" }));

    await waitFor(() =>
      expect(fake.callsOf("openExternal")).toEqual([
        { url: "https://example.org/Alpha" },
        { url: "https://www.nuget.org/packages/Alpha" }
      ])
    );
  });

  it("a package from another feed has no NuGet.Org item", async () => {
    const { user } = open({
      configure: (fake) => {
        fake.backend.packageDetails = (params) =>
          Promise.resolve({ ...details(params.id, ["1.0.0"]), feed: "private" });
      }
    });
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    expect(await screen.findByRole("menuitem", { name: "Show Project Page" })).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    expect(screen.queryByRole("menuitem", { name: "Show Package on NuGet.Org" })).not.toBeInTheDocument();
  });

  it("copying puts the name on the clipboard through the host", async () => {
    const { fake, user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(menuItem(/^Copy Package Name/));

    await waitFor(() => expect(fake.callsOf("copyText")).toEqual([{ text: "Alpha" }]));
  });

  it("the two toggles open and close the sections of the details", async () => {
    const { user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });
    await user.click(menuItem(/^Toggle NuGet Info Expander/));

    expect(await screen.findByRole("button", { name: "Info" })).toHaveAttribute("aria-expanded", "true");

    await user.pointer({ keys: "[MouseRight]", target: await alpha() });
    await user.click(menuItem(/^Toggle NuGet Dependencies Expander/));
    expect(screen.getByRole("button", { name: "Frameworks and Dependencies" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await user.pointer({ keys: "[MouseRight]", target: await alpha() });
    await user.click(menuItem(/^Toggle NuGet Info Expander/));
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute("aria-expanded", "false");
  });

  it("Ctrl+. opens it for the selected package, and the hint says so", async () => {
    const { user } = open();
    expect(screen.queryByText(/to show the context menu/)).not.toBeInTheDocument();
    await user.click(await alpha());
    expect(screen.getByText("Ctrl+. to show the context menu")).toBeInTheDocument();

    await user.keyboard("{Control>}.{/Control}");

    expect(screen.getByRole("menu", { name: "Actions for Alpha" })).toBeInTheDocument();
  });

  it("Ctrl+. does nothing with no package selected", async () => {
    const { user } = open();
    await updateGroup();

    screen.getByRole("searchbox", { name: "Search packages" }).focus();
    await user.keyboard("{Control>}.{/Control}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("it works from the keyboard: arrows move, Enter chooses, Escape closes", async () => {
    const { fake, user } = open();
    await user.click(await alpha());
    await user.keyboard("{Control>}.{/Control}");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.keyboard("{Control>}.{/Control}");
    await user.keyboard("{End}{Enter}");

    await waitFor(() => expect(fake.callsOf("copyText")).toEqual([{ text: "Alpha" }]));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a click elsewhere closes it", async () => {
    const { user } = open();
    await user.pointer({ keys: "[MouseRight]", target: await alpha() });

    await user.click(screen.getByRole("searchbox", { name: "Search packages" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("the keys of its items work without it: Ctrl+I, Ctrl+D and Ctrl+C", async () => {
    const { fake, user } = open();
    await user.click(await alpha());
    await screen.findByRole("button", { name: "Info" });

    await user.keyboard("{Control>}i{/Control}");
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Control>}d{/Control}");
    expect(screen.getByRole("button", { name: "Frameworks and Dependencies" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    await user.keyboard("{Control>}c{/Control}");

    await waitFor(() => expect(fake.callsOf("copyText")).toEqual([{ text: "Alpha" }]));
  });

  it("a package of the Discover list has the menu too", async () => {
    const { user } = open({
      configure: (fake) => {
        fake.backend.searchPackages = () =>
          Promise.resolve({ packages: [{ id: "Newton", version: "13.0.4", feed: "nuget.org" }], failures: [] });
      }
    });
    await user.click(await screen.findByRole("tab", { name: "Discover" }));

    await user.pointer({ keys: "[MouseRight]", target: await screen.findByRole("button", { name: "Newton" }) });

    const menu = screen.getByRole("menu", { name: "Actions for Newton" });
    expect(within(menu).queryByRole("menuitem", { name: /^(Update|Remove)/ })).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Show All Package Versions in File Explorer" })
    ).toBeInTheDocument();
  });
});

describe("the side bar of Packages", () => {
  it("Restore runs restore/run", async () => {
    const { fake, user } = open();
    await updateGroup();

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(fake.callsOf("restore")).toEqual([{ force: false }]));
  });

  it("Refresh reloads the installed packages and the updates without the caches", async () => {
    const { fake, user } = open();
    await updateGroup();
    const before = fake.callsOf("installedPackages").length;

    await user.click(screen.getByRole("button", { name: "Refresh NuGet Packages and Clear the Caches" }));

    await waitFor(() => expect(fake.callsOf("packageUpdates")).toContainEqual({ prerelease: false, noCache: true }));
    expect(fake.callsOf("installedPackages").length).toBeGreaterThan(before);
  });

  it("the details position toggles and is remembered", async () => {
    const { user, storage } = open();
    await updateGroup();

    await user.click(screen.getByRole("button", { name: "Show Details Below" }));

    expect(screen.getByRole("button", { name: "Show Details on the Side" })).toBeInTheDocument();
    await waitFor(() => expect(storage.get()).toMatchObject({ detailsPosition: "bottom" }));
  });

  it("the sort mode toggles, reorders the list and is remembered", async () => {
    const { user, storage } = open();
    await updateGroup();
    const names = (): string[] =>
      within(screen.getByRole("heading", { name: /^Installed Packages/ }).closest("section")!)
        .getAllByRole("listitem")
        .map((item) => item.textContent.split(" ")[0]!);
    expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);

    await user.click(screen.getByRole("button", { name: /^Sort: Smart/ }));

    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    await waitFor(() => expect(storage.get()).toMatchObject({ sort: "alphabetical" }));
  });

  it("a remembered target that is not in this solution falls back to the solution", async () => {
    open({ stored: { target: "/elsewhere/Old.csproj" } });

    expect(await screen.findByRole("heading", { name: "Installed Packages in Solution: 3" })).toBeInTheDocument();
  });
});
