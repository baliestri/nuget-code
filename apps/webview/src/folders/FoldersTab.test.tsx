import { BridgeError } from "@nuget-code/bridge";
import type { FolderInfo, FolderSizeResult } from "@nuget-code/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFakeBridge, createMemoryStorage, type FakeBridge } from "../../test/fakeBridge";
import { Root } from "../app/Root";
import { describeCleared, overlaps } from "./FoldersTab";

const GLOBAL: FolderInfo = { title: "Global Packages", path: "/home/me/.nuget/packages", clearable: true };
const HTTP: FolderInfo = { title: "HTTP Cache", path: "/home/me/.local/share/NuGet/v3-cache", clearable: true };
const SETTINGS: FolderInfo = { title: "UserSettings", path: "/home/me/.nuget/NuGet", clearable: false };
const FOLDERS = [GLOBAL, HTTP, SETTINGS];

const SIZES: Record<string, FolderSizeResult> = {
  [GLOBAL.path]: { exists: true, bytes: 13 * 1024 * 1024 },
  [HTTP.path]: { exists: true, bytes: 1536 },
  [SETTINGS.path]: { exists: false, bytes: 0 }
};

function open(configure?: (fake: FakeBridge) => void, stored: Record<string, unknown> = {}) {
  const fake = createFakeBridge();
  fake.backend.listFolders = () => Promise.resolve({ folders: FOLDERS });
  fake.backend.folderSize = (params) => Promise.resolve(SIZES[params.path]!);
  fake.backend.clearFolders = (params) =>
    Promise.resolve({ folders: params.paths.map((path) => ({ path, bytesFreed: 2048, skipped: [] })) });
  configure?.(fake);
  const storage = createMemoryStorage({ tab: "folders", ...stored });
  render(<Root client={fake.client} storage={storage} />);
  return { fake, storage, user: userEvent.setup() };
}

const row = (title: string): Promise<HTMLElement> => screen.findByRole("row", { name: new RegExp(`^${title}`) });
const cells = (element: HTMLElement): string[] =>
  within(element)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

describe("Folders", () => {
  it("lists title and path, with ? as the size", async () => {
    open();

    expect(cells(await row("Global Packages"))).toEqual([GLOBAL.path, "?"]);
    expect(cells(await row("UserSettings"))).toEqual([SETTINGS.path, "?"]);
  });

  it("Recalculate asks for each size in turn and fills them in", async () => {
    const { fake, user } = open();
    await row("Global Packages");

    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));

    await waitFor(async () => expect(cells(await row("HTTP Cache"))[1]).toBe("1.5 KB"));
    expect(cells(await row("Global Packages"))[1]).toBe("13.0 MB");
    expect(fake.callsOf("folderSize")).toEqual(FOLDERS.map((folder) => ({ path: folder.path })));
  });

  it("the sizes are asked for one at a time", async () => {
    let running = 0;
    let most = 0;
    const { user } = open((fake) => {
      fake.backend.folderSize = async (params) => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return SIZES[params.path]!;
      };
    });
    await row("Global Packages");

    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));

    await waitFor(async () => expect(cells(await row("UserSettings"))[1]).toBe("—"));
    expect(most).toBe(1);
  });

  it("measured sizes are kept: they are there when the tab is opened again, without measuring", async () => {
    const { fake, user, storage } = open();
    await row("Global Packages");
    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));
    await waitFor(async () => expect(cells(await row("UserSettings"))[1]).toBe("—"));
    const asked = fake.callsOf("folderSize").length;

    await user.click(screen.getByRole("tab", { name: "Log" }));
    await user.click(screen.getByRole("tab", { name: "Folders" }));

    expect(cells(await row("Global Packages"))[1]).toBe("13.0 MB");
    expect(cells(await row("HTTP Cache"))[1]).toBe("1.5 KB");
    expect(fake.callsOf("folderSize")).toHaveLength(asked);
    expect(storage.get()).toMatchObject({
      folderSizes: { [GLOBAL.path]: { exists: true, bytes: 13 * 1024 * 1024 }, [SETTINGS.path]: { exists: false } }
    });
  });

  it("sizes stored by an earlier session are shown, with when they were measured", async () => {
    const at = Date.now() - 24 * 60 * 60 * 1000;
    const { fake } = open(undefined, { folderSizes: { [HTTP.path]: { exists: true, bytes: 2048, at } } });

    const http = await row("HTTP Cache");
    expect(cells(http)[1]).toBe("2.0 KB");
    expect(within(http).getAllByRole("cell")[1]?.title).toMatch(/^Measured on /);
    expect(cells(await row("Global Packages"))[1]).toBe("?");
    expect(fake.callsOf("folderSize")).toEqual([]);
  });

  it("a size measured more than a month ago is not shown", async () => {
    const at = Date.now() - 31 * 24 * 60 * 60 * 1000;
    open(undefined, { folderSizes: { [HTTP.path]: { exists: true, bytes: 2048, at } } });

    expect(cells(await row("HTTP Cache"))[1]).toBe("?");
  });

  it("measuring again replaces what was stored", async () => {
    const { user } = open(undefined, { folderSizes: { [HTTP.path]: { exists: true, bytes: 2048, at: Date.now() } } });
    await row("HTTP Cache");

    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));

    await waitFor(async () => expect(cells(await row("HTTP Cache"))[1]).toBe("1.5 KB"));
  });

  it("a folder that could not be opened says why", async () => {
    const { user } = open((fake) => {
      fake.host.openFolder = () =>
        Promise.reject(new BridgeError({ kind: "host", message: "That folder is not one of the NuGet folders." }));
    });
    await user.click(await row("HTTP Cache"));

    await user.click(screen.getByRole("button", { name: "Open Folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The folder could not be opened. That folder is not one of the NuGet folders."
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a folder that does not exist shows a dash, and one that cannot be measured says why", async () => {
    const { user } = open((fake) => {
      fake.backend.folderSize = (params) =>
        params.path === HTTP.path
          ? Promise.reject(new BridgeError({ kind: "backend", code: 1109, message: "no" }))
          : Promise.resolve(SIZES[params.path]!);
    });
    await row("Global Packages");

    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));

    await waitFor(async () => expect(cells(await row("UserSettings"))[1]).toBe("—"));
    expect(cells(await row("HTTP Cache"))[1]).toBe("failed");
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP Cache could not be measured. no");
  });

  it("Open Folder opens the selected folder, and needs exactly one", async () => {
    const { fake, user } = open();
    const open1 = (): HTMLElement => screen.getByRole("button", { name: "Open Folder" });
    await row("Global Packages");
    expect(open1()).toBeDisabled();

    await user.click(await row("HTTP Cache"));
    expect(await row("HTTP Cache")).toHaveAttribute("aria-selected", "true");
    await user.click(open1());
    await waitFor(() => expect(fake.callsOf("openFolder")).toEqual([{ path: HTTP.path }]));

    await user.keyboard("{Control>}");
    await user.click(await row("Global Packages"));
    await user.keyboard("{/Control}");
    expect(open1()).toBeDisabled();
  });

  it("a plain click selects only that folder", async () => {
    const { user } = open();

    await user.click(await row("HTTP Cache"));
    await user.click(await row("Global Packages"));

    expect(await row("HTTP Cache")).toHaveAttribute("aria-selected", "false");
    expect(await row("Global Packages")).toHaveAttribute("aria-selected", "true");
  });

  it("Clear is enabled only when every selected folder is clearable", async () => {
    const { user } = open();
    const clear = (): HTMLElement => screen.getByRole("button", { name: "Clear Selected Caches" });
    await row("Global Packages");
    expect(clear()).toBeDisabled();

    await user.click(await row("Global Packages"));
    expect(clear()).toBeEnabled();

    await user.keyboard("{Control>}");
    await user.click(await row("UserSettings"));
    await user.keyboard("{/Control}");
    expect(clear()).toBeDisabled();
  });

  it("Clear asks for confirmation and lists the folders; cancelling clears nothing", async () => {
    const { fake, user } = open();
    await row("Global Packages");
    await user.click(screen.getByRole("button", { name: "Recalculate Folder Sizes" }));
    await waitFor(async () => expect(cells(await row("UserSettings"))[1]).toBe("—"));
    await user.click(await row("Global Packages"));

    await user.click(screen.getByRole("button", { name: "Clear Selected Caches" }));

    const dialog = screen.getByRole("dialog", { name: "Clear the selected caches?" });
    const listed = within(within(dialog).getByRole("list", { name: "Folders to clear" })).getAllByRole("listitem");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toHaveTextContent("Global Packages (13.0 MB)");
    expect(listed[0]).toHaveTextContent(GLOBAL.path);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.callsOf("clearFolders")).toEqual([]);
  });

  it("a clear that removed everything is an information notification of the editor", async () => {
    const { fake, user } = open();
    await user.click(await row("HTTP Cache"));

    await user.click(screen.getByRole("button", { name: "Clear Selected Caches" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(fake.callsOf("notify")).toEqual([{ kind: "info", messages: ["HTTP Cache: 2.0 KB freed."] }])
    );
    expect(screen.queryByText(/freed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("after clearing it notifies what was freed and what was skipped, as a warning, and recalculates", async () => {
    const { fake, user } = open((bridge) => {
      bridge.backend.clearFolders = () =>
        Promise.resolve({
          folders: [
            { path: GLOBAL.path, bytesFreed: 13 * 1024 * 1024, skipped: [] },
            { path: HTTP.path, bytesFreed: 1024, skipped: ["/home/me/.local/share/NuGet/v3-cache/locked.dat"] }
          ]
        });
    });
    await user.click(await row("Global Packages"));
    await user.keyboard("{Control>}");
    await user.click(await row("HTTP Cache"));
    await user.keyboard("{/Control}");

    await user.click(screen.getByRole("button", { name: "Clear Selected Caches" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(fake.callsOf("notify")).toHaveLength(1));
    expect(fake.callsOf("notify")[0]).toEqual({
      kind: "warning",
      messages: [
        "Global Packages: 13.0 MB freed.",
        "HTTP Cache: 1.0 KB freed.",
        "HTTP Cache: 1 could not be removed, probably in use: /home/me/.local/share/NuGet/v3-cache/locked.dat."
      ]
    });
    expect(screen.queryByText(/freed/)).not.toBeInTheDocument();
    expect(fake.callsOf("clearFolders")).toEqual([{ paths: [GLOBAL.path, HTTP.path] }]);
    // Only the cleared folders are measured again; the settings folder is not.
    await waitFor(() => expect(fake.callsOf("folderSize")).toEqual([{ path: GLOBAL.path }, { path: HTTP.path }]));
  });

  it("a refusal from the backend is shown", async () => {
    const { user } = open((fake) => {
      fake.backend.clearFolders = () =>
        Promise.reject(new BridgeError({ kind: "backend", code: 1109, message: "That folder is not a cache." }));
    });
    await user.click(await row("Global Packages"));

    await user.click(screen.getByRole("button", { name: "Clear Selected Caches" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The folders were not cleared. That folder is not a cache."
    );
  });

  it("an error listing the folders is shown", async () => {
    open((fake) => {
      fake.backend.listFolders = () => Promise.reject(new BridgeError({ kind: "stopped", message: "Stopped." }));
    });

    expect(await screen.findByText("The folders could not be listed")).toBeInTheDocument();
  });
});

describe("overlaps", () => {
  it("a folder overlaps itself, whatever the case, the separator or a trailing one", () => {
    expect(overlaps("C:\\Users\\me\\.nuget\\packages\\", "c:/users/me/.nuget/packages")).toBe(true);
  });

  it("a folder overlaps the ones that hold it and the ones inside it", () => {
    expect(overlaps("/home/me/.nuget", "/home/me/.nuget/packages")).toBe(true);
    expect(overlaps("/home/me/.nuget/packages", "/home/me/.nuget")).toBe(true);
  });

  it("siblings do not overlap, even when one name starts with the other", () => {
    expect(overlaps("/home/me/.nuget/packages", "/home/me/.nuget/NuGet")).toBe(false);
    expect(overlaps("/cache/v3", "/cache/v3-cache")).toBe(false);
  });
});

describe("describeCleared", () => {
  it("cuts a long list of skipped files short", () => {
    const skipped = Array.from({ length: 8 }, (_, index) => `/f/${index}`);

    const lines = describeCleared({ folders: [{ path: HTTP.path, bytesFreed: 0, skipped }] }, FOLDERS);

    expect(lines).toEqual([
      "HTTP Cache: 0 B freed.",
      "HTTP Cache: 8 could not be removed, probably in use: /f/0, /f/1, /f/2, /f/3, /f/4 and 3 more."
    ]);
  });

  it("a folder it does not know is named by its path", () => {
    expect(describeCleared({ folders: [{ path: "/x", bytesFreed: 1, skipped: [] }] }, FOLDERS)).toEqual([
      "/x: 1 B freed."
    ]);
  });
});
