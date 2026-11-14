import { BridgeError } from "@nuget-code/bridge";
import type { ConfigFileInfo, FeedInfo, SourcesListResult } from "@nuget-code/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFakeBridge, createMemoryStorage, type FakeBridge } from "../../test/fakeBridge";
import { Root } from "../app/Root";

const SOLUTION_CONFIG = "/work/NuGet.config";
const USER_CONFIG = "/home/me/.nuget/NuGet/NuGet.Config";
const MACHINE_CONFIG = "/etc/nuget/machine.config";

function feed(name: string, extra: Partial<FeedInfo> = {}): FeedInfo {
  return {
    name,
    source: `https://${name}.example/v3/index.json`,
    enabled: true,
    allowInsecureConnections: false,
    protocolVersion: 3,
    isLocal: false,
    disableTlsCertificateValidation: false,
    isMachineWide: false,
    ...extra
  };
}

const PRIVATE = feed("private", { declaredIn: SOLUTION_CONFIG });
const PUBLIC = feed("public", { declaredIn: USER_CONFIG });
const OFFLINE = feed("offline", { declaredIn: MACHINE_CONFIG, isMachineWide: true });

function sources(files: Partial<ConfigFileInfo>[] = []): SourcesListResult {
  const defaults: ConfigFileInfo[] = [
    {
      path: SOLUTION_CONFIG,
      feeds: [PRIVATE],
      writable: true,
      isMachineWide: false,
      globalPackagesFolder: "/work/global"
    },
    { path: USER_CONFIG, feeds: [PUBLIC], writable: true, isMachineWide: false },
    { path: MACHINE_CONFIG, feeds: [OFFLINE], writable: false, isMachineWide: true }
  ];
  return {
    files: defaults.map((file, index) => ({ ...file, ...files[index] })),
    effective: [PRIVATE, PUBLIC, OFFLINE],
    fallbackFolders: [],
    globalPackagesFolder: "/work/global",
    localPackagesFolder: "/work/packages"
  };
}

function open(result: SourcesListResult = sources(), configure?: (fake: FakeBridge) => void) {
  const fake = createFakeBridge();
  fake.backend.listSources = () => Promise.resolve(result);
  fake.backend.addSource = () => Promise.resolve(PRIVATE);
  fake.backend.updateSource = () => Promise.resolve(PRIVATE);
  fake.backend.removeSource = () => Promise.resolve({});
  fake.backend.setSourceProperty = () => Promise.resolve({});
  configure?.(fake);
  render(<Root client={fake.client} storage={createMemoryStorage({ tab: "sources" })} />);
  return { fake, user: userEvent.setup() };
}

const files = (): Promise<HTMLElement> => screen.findByRole("list", { name: "Configuration files" });

async function selectFile(user: ReturnType<typeof userEvent.setup>, path: string): Promise<void> {
  await user.click(within(await files()).getByRole("button", { name: path }));
}

describe("the file list", () => {
  it("starts with the effective view, which is selected", async () => {
    open();

    const buttons = within(await files()).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "[Effective NuGet.Config]",
      SOLUTION_CONFIG,
      USER_CONFIG,
      MACHINE_CONFIG
    ]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting a file shows only its feeds", async () => {
    const { user } = open();

    await selectFile(user, USER_CONFIG);

    expect(screen.getByRole("rowheader", { name: "public" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "private" })).not.toBeInTheDocument();
  });

  it("an error reading the sources is shown", async () => {
    open(sources(), (fake) => {
      fake.backend.listSources = () =>
        Promise.reject(new BridgeError({ kind: "stopped", message: "The backend stopped." }));
    });

    expect(await screen.findByText("The sources could not be read")).toBeInTheDocument();
    expect(screen.getByText("The backend stopped.")).toBeInTheDocument();
  });
});

describe("Feeds", () => {
  it("the table shows name, URL and the two flags", async () => {
    open(sources([{ feeds: [{ ...PRIVATE, allowInsecureConnections: true, enabled: false }] }]));
    await files();
    await userEvent.setup().click(screen.getByRole("button", { name: SOLUTION_CONFIG }));

    const row = screen.getByRole("rowheader", { name: "private" }).closest("tr")!;
    expect(within(row).getByText("https://private.example/v3/index.json")).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Allow insecure connections: private" })).toBeChecked();
    expect(within(row).getByRole("checkbox", { name: "Enabled: private" })).not.toBeChecked();
  });

  it("toggling Enabled updates the feed in the file that declares it", async () => {
    const { fake, user } = open();
    await files();

    await user.click(screen.getByRole("checkbox", { name: "Enabled: public" }));

    await waitFor(() =>
      expect(fake.callsOf("updateSource")).toEqual([{ file: USER_CONFIG, name: "public", enabled: false }])
    );
  });

  it("toggling Allow insecure updates only that flag", async () => {
    const { fake, user } = open();
    await files();

    await user.click(screen.getByRole("checkbox", { name: "Allow insecure connections: private" }));

    await waitFor(() =>
      expect(fake.callsOf("updateSource")).toEqual([
        { file: SOLUTION_CONFIG, name: "private", allowInsecureConnections: true }
      ])
    );
  });

  it("a new feed from the effective view has no file", async () => {
    const { fake, user } = open();
    await files();

    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "mine");
    await user.clear(screen.getByRole("textbox", { name: "URL:" }));
    await user.type(screen.getByRole("textbox", { name: "URL:" }), "https://mine.example/index.json");
    await user.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(fake.callsOf("addSource")).toEqual([
        {
          name: "mine",
          source: "https://mine.example/index.json",
          enabled: true,
          allowInsecureConnections: false,
          disableTlsCertificateValidation: false
        }
      ])
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a new feed from a file names that file", async () => {
    const { fake, user } = open();
    await selectFile(user, USER_CONFIG);

    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "mine");
    await user.type(screen.getByRole("textbox", { name: "URL:" }), "mine.example");
    await user.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(fake.callsOf("addSource")[0]).toMatchObject({ file: USER_CONFIG, name: "mine" }));
  });

  it("the dialog validates name and URL before sending", async () => {
    const { fake, user } = open();
    await files();
    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    const ok = screen.getByRole("button", { name: "OK" });

    expect(ok).toBeDisabled();
    expect(screen.getByText("A name is needed.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "mine");
    expect(ok).toBeEnabled();
    await user.clear(screen.getByRole("textbox", { name: "URL:" }));

    expect(ok).toBeDisabled();
    expect(fake.callsOf("addSource")).toEqual([]);
  });

  it("editing sends the new name and the values to the file that declares the feed", async () => {
    const { fake, user } = open();
    await files();

    await user.click(screen.getByRole("button", { name: "Edit public" }));
    expect(screen.getByRole("dialog", { name: "Editing: public" })).toBeInTheDocument();
    const name = screen.getByRole("textbox", { name: "Name:" });
    await user.clear(name);
    await user.type(name, "renamed");
    await user.click(screen.getByRole("checkbox", { name: "Disable TLS certificate validation" }));
    await user.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(fake.callsOf("updateSource")).toEqual([
        {
          file: USER_CONFIG,
          name: "public",
          newName: "renamed",
          source: PUBLIC.source,
          enabled: true,
          allowInsecureConnections: false,
          disableTlsCertificateValidation: true
        }
      ])
    );
  });

  it("a backend error such as a duplicate name is shown in the dialog, which stays open", async () => {
    const { user } = open(sources(), (fake) => {
      fake.backend.addSource = () =>
        Promise.reject(
          new BridgeError({ kind: "backend", code: 1108, message: "A source named 'private' already exists." })
        );
    });
    await files();
    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    await user.type(screen.getByRole("textbox", { name: "Name:" }), "private");
    await user.type(screen.getByRole("textbox", { name: "URL:" }), "x.example");

    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "A source named 'private' already exists."
    );
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();
  });

  it("user and password are saved through the host and never sent to the backend", async () => {
    const { fake, user } = open();
    await files();
    await user.click(screen.getByRole("button", { name: "Edit private" }));

    await user.type(screen.getByRole("textbox", { name: "User:" }), "me");
    await user.type(screen.getByLabelText("Password:"), "s3cr3t");
    await user.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(fake.callsOf("saveCredential")).toEqual([{ source: PRIVATE.source, username: "me", password: "s3cr3t" }])
    );
    expect(JSON.stringify(fake.calls.filter((call) => call.kind === "backend"))).not.toContain("s3cr3t");
    expect(fake.callsOf("updateSource")[0]).not.toHaveProperty("username");
  });

  it("empty credentials are not saved", async () => {
    const { fake, user } = open();
    await files();
    await user.click(screen.getByRole("button", { name: "Edit private" }));

    await user.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => expect(fake.callsOf("updateSource")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.callsOf("saveCredential")).toEqual([]);
  });

  it("a user without a password, or credentials for a folder, cannot be sent", async () => {
    const { user } = open();
    await files();
    await user.click(screen.getByRole("button", { name: "Edit private" }));

    await user.type(screen.getByRole("textbox", { name: "User:" }), "me");
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await user.type(screen.getByLabelText("Password:"), "x");
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();
    await user.clear(screen.getByRole("textbox", { name: "URL:" }));
    await user.type(screen.getByRole("textbox", { name: "URL:" }), "/feeds/local");

    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
  });

  it("credentials that could not be saved are reported, with the feed already written", async () => {
    const { fake, user } = open(sources(), (bridge) => {
      bridge.host.saveCredential = () =>
        Promise.reject(new BridgeError({ kind: "host", message: "The secret storage is locked." }));
    });
    await files();
    await user.click(screen.getByRole("button", { name: "Edit private" }));
    await user.type(screen.getByRole("textbox", { name: "User:" }), "me");
    await user.type(screen.getByLabelText("Password:"), "x");

    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The feed was saved, but its credentials were not. The secret storage is locked."
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.callsOf("updateSource")).toHaveLength(1);
  });

  it("Cancel and Escape close the dialog without writing", async () => {
    const { fake, user } = open();
    await files();

    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a feed" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.callsOf("addSource")).toEqual([]);
  });

  it("removing a feed asks nothing and reloads", async () => {
    const { fake, user } = open();
    await files();
    const before = fake.callsOf("listSources").length;

    await user.click(screen.getByRole("button", { name: "Remove private" }));

    await waitFor(() => expect(fake.callsOf("removeSource")).toEqual([{ file: SOLUTION_CONFIG, name: "private" }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(fake.callsOf("listSources").length).toBeGreaterThan(before));
  });

  it("a change the backend refuses is shown above the table", async () => {
    const { user } = open(sources(), (fake) => {
      fake.backend.removeSource = () =>
        Promise.reject(new BridgeError({ kind: "backend", code: 1107, message: "The file is read-only." }));
    });
    await files();

    await user.click(screen.getByRole("button", { name: "Remove private" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The file is read-only.");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a file that is not writable is read-only, with a notice", async () => {
    const { user } = open(sources([{}, { writable: false }]));

    await selectFile(user, USER_CONFIG);

    expect(screen.getByText(/cannot be written/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit public" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove public" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a feed" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enabled: public" })).toBeDisabled();
  });

  it("a machine-wide feed can still be enabled or disabled, and nothing else", async () => {
    const { fake, user } = open();
    await files();

    expect(screen.queryByRole("button", { name: "Edit offline" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Allow insecure connections: offline" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Enabled: offline" }));

    await waitFor(() =>
      expect(fake.callsOf("updateSource")).toEqual([{ file: MACHINE_CONFIG, name: "offline", enabled: false }])
    );
  });
});

describe("Properties", () => {
  async function properties(user: ReturnType<typeof userEvent.setup>, path?: string): Promise<void> {
    await files();
    if (path !== undefined) {
      await selectFile(user, path);
    }

    await user.click(screen.getByRole("tab", { name: "Properties" }));
  }

  it("show the declared value and the resolved one", async () => {
    const { user } = open();

    await properties(user, SOLUTION_CONFIG);

    expect(screen.getByRole("textbox", { name: "Global packages folder:" })).toHaveValue("/work/global");
    expect(screen.getByRole("textbox", { name: "Local packages folder:" })).toHaveValue("");
    expect(screen.getByText("/work/packages")).toBeInTheDocument();
  });

  it("choosing a folder sets the property through the host picker", async () => {
    const { fake, user } = open(sources(), (bridge) => {
      bridge.host.pickFolder = () => Promise.resolve({ path: "/chosen" });
    });
    await properties(user, SOLUTION_CONFIG);

    await user.click(screen.getByRole("button", { name: "Choose: Local packages folder" }));

    await waitFor(() =>
      expect(fake.callsOf("setSourceProperty")).toEqual([
        { file: SOLUTION_CONFIG, property: "repositoryPath", value: "/chosen" }
      ])
    );
    expect(fake.callsOf("pickFolder")).toEqual([{ title: "Local packages folder" }]);
  });

  it("giving up on the picker changes nothing", async () => {
    const { fake, user } = open();
    await properties(user, SOLUTION_CONFIG);

    await user.click(screen.getByRole("button", { name: "Choose: Local packages folder" }));

    await waitFor(() => expect(fake.callsOf("pickFolder")).toHaveLength(1));
    expect(fake.callsOf("setSourceProperty")).toEqual([]);
  });

  it("typing a value sets it when the field is left", async () => {
    const { fake, user } = open();
    await properties(user, SOLUTION_CONFIG);

    await user.type(screen.getByRole("textbox", { name: "Local packages folder:" }), "/typed{Enter}");

    await waitFor(() =>
      expect(fake.callsOf("setSourceProperty")).toEqual([
        { file: SOLUTION_CONFIG, property: "repositoryPath", value: "/typed" }
      ])
    );
  });

  it("clearing a property sends no value", async () => {
    const { fake, user } = open();
    await properties(user, SOLUTION_CONFIG);

    await user.clear(screen.getByRole("textbox", { name: "Global packages folder:" }));
    await user.tab();

    await waitFor(() =>
      expect(fake.callsOf("setSourceProperty")).toEqual([{ file: SOLUTION_CONFIG, property: "globalPackagesFolder" }])
    );
  });

  it("are read-only in the effective view", async () => {
    const { user } = open();

    await properties(user);

    expect(screen.getByRole("textbox", { name: "Global packages folder:" })).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Choose: Global packages folder" })).toBeDisabled();
    expect(screen.getByText("/work/global")).toBeInTheDocument();
  });
});

describe("Summary and the side bar", () => {
  it("the summary is the effective configuration as text", async () => {
    const { user } = open();
    await files();

    await user.click(screen.getByRole("tab", { name: "Summary" }));

    const summary = screen.getByLabelText("Summary");
    expect(summary).toHaveTextContent("### Feeds");
    expect(summary).toHaveTextContent("* private");
    expect(summary).toHaveTextContent(`DeclaredIn = ${USER_CONFIG}`);
  });

  it("Reload fetches sources again", async () => {
    const { fake, user } = open();
    await files();
    const before = fake.callsOf("listSources").length;

    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(fake.callsOf("listSources").length).toBeGreaterThan(before));
  });

  it("the details position toggles", async () => {
    const { user } = open();
    await files();

    await user.click(screen.getByRole("button", { name: "Show Details Below" }));

    expect(screen.getByRole("button", { name: "Show Details on the Side" })).toBeInTheDocument();
  });
});
