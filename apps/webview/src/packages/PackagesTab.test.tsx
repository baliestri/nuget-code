import { BridgeError, type SessionState } from "@nuget-code/bridge";
import type {
  FeedInfo,
  InstalledPackage,
  OperationResult,
  PackageDetailsResult,
  PackagesInstalledResult,
  PackagesUpdatesResult,
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
  hasSdk: true
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
    { projectPath: APP, packages: [pkg("Alpha", "1.0.0"), pkg("Beta", "2.0.0")] },
    { projectPath: LIB, packages: [pkg("Alpha", "1.0.0"), pkg("Gamma", "3.0.0")] }
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
    failures: []
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
  session?: SessionState;
  stored?: unknown;
  configure?(fake: FakeBridge): void;
}

function open(setup: Setup = {}) {
  const fake = createFakeBridge(setup.session ?? SESSION);
  fake.backend.installedPackages = () => Promise.resolve(setup.installed ?? INSTALLED);
  fake.backend.packageUpdates = () => Promise.resolve(setup.updates ?? UPDATES);
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

    await user.selectOptions(screen.getByRole("combobox", { name: "Target" }), "App (2 packages)");

    expect(await screen.findByRole("heading", { name: "Installed Packages in App: 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Packages to Update in App: 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Gamma/ })).not.toBeInTheDocument();
  });

  it("the toolbar lists the solution and each project with its package count", async () => {
    open();
    await updateGroup();

    const options = within(screen.getByRole("combobox", { name: "Target" })).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Solution", "App (2 packages)", "Lib (2 packages)"]);
  });

  it("a project that failed to evaluate is disabled in the target list", async () => {
    const projects = [PROJECTS[0]!, { ...PROJECTS[1]!, error: "MSB4025: the project file could not be loaded." }];
    open({
      session: { ...SESSION, solution: { kind: "open", name: "Sample.slnx", path: "/work/Sample.slnx", projects } }
    });
    await updateGroup();

    expect(screen.getByRole("option", { name: /^Lib/ })).toBeDisabled();
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
      installed: { projects: [{ projectPath: APP, packages: [pkg("Sdk.Implicit", "1.0.0", { implicit: true })] }] },
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

  it("groups collapse and expand", async () => {
    const { user } = open();
    await updateGroup();
    const toggle = screen.getByRole("button", { name: /^Collapse: Installed Packages/ });

    await user.click(toggle);

    expect(screen.getByRole("button", { name: /^Expand: Installed Packages/ })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
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

    await user.selectOptions(screen.getByRole("combobox", { name: "Feed" }), "Manage Feeds…");

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

  it("plan warnings are listed after the operation, and can be dismissed", async () => {
    const { user, pending } = await startUpdate({
      configure: (fake) => {
        fake.backend.planPackages = () =>
          Promise.resolve({
            edits: [],
            warnings: [{ kind: "downgrade", packageId: "Gamma", projects: [], packages: [], detail: "5.0.0" }]
          });
      }
    });

    pending.resolve(succeeded([LIB]));

    expect(await screen.findByText("Gamma: this is a downgrade from 5.0.0.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/downgrade/)).not.toBeInTheDocument();
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
