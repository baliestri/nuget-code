import type { SessionState } from "@nuget-code/bridge";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFakeBridge, createMemoryStorage, READY } from "../../test/fakeBridge";
import { Root } from "./Root";

const OPEN: SessionState = {
  backend: "ready",
  solution: { kind: "open", name: "Sample.slnx", path: "/work/Sample.slnx", projects: [] },
  hasSdk: true
};

function open(session: SessionState | null = READY, stored?: unknown) {
  const fake = createFakeBridge(session);
  const storage = createMemoryStorage(stored);
  render(<Root client={fake.client} storage={storage} />);
  return { fake, storage, user: userEvent.setup() };
}

describe("the shell", () => {
  it("shows the four tabs and switches between them", async () => {
    const { user } = open(OPEN);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Packages", "Sources", "Folders", "Log"]);
    expect(screen.getByRole("tab", { name: "Packages" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Folders" }));

    expect(screen.getByRole("tab", { name: "Folders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Packages" })).toHaveAttribute("aria-selected", "false");
  });

  it("tells the host it is ready once", async () => {
    const { fake } = open();

    await waitFor(() => expect(fake.readyCount()).toBe(1));
  });

  it("the selected tab is remembered", async () => {
    const { user, storage } = open(OPEN);

    await user.click(await screen.findByRole("tab", { name: "Log" }));

    await waitFor(() => expect(storage.get()).toMatchObject({ tab: "log" }));
  });

  it("starts on the remembered tab", async () => {
    open(OPEN, { tab: "sources" });

    expect(await screen.findByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  });

  it("the name of the open solution selects another one", async () => {
    const { fake, user } = open(OPEN);

    await user.click(await screen.findByRole("button", { name: /Sample\.slnx/ }));

    await waitFor(() => expect(fake.callsOf("selectSolution")).toHaveLength(1));
  });
});

describe("without a backend or a solution", () => {
  it("shows Starting… before the host has said anything", () => {
    open(null);

    expect(screen.getByText("Starting…")).toBeInTheDocument();
  });

  it("a starting backend shows Starting…", async () => {
    open({ ...READY, backend: "starting" });

    expect(await screen.findByRole("status", { name: "Starting the NuGet backend" })).toBeInTheDocument();
  });

  it("a stopped backend offers Restart and Show Log", async () => {
    const { fake, user } = open({ ...READY, backend: "stopped" });

    expect(await screen.findByText("The NuGet backend is not running")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart" }));
    await user.click(screen.getByRole("button", { name: "Show Log" }));

    await waitFor(() => expect(fake.calls.map((call) => call.method)).toEqual(["restartBackend", "showLog"]));
  });

  it("without a solution, Packages asks for one", async () => {
    const { fake, user } = open(READY);

    await user.click(await screen.findByRole("button", { name: "Select Solution" }));

    await waitFor(() => expect(fake.callsOf("selectSolution")).toHaveLength(1));
  });

  it("without a solution, the other tabs still open", async () => {
    const { user } = open(READY);

    await user.click(await screen.findByRole("tab", { name: "Sources" }));

    expect(screen.queryByRole("button", { name: "Select Solution" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Actions" })).toBeInTheDocument();
  });

  it("a solution that is being opened says so", async () => {
    open({ ...READY, solution: { kind: "opening" } });

    expect(await screen.findByRole("status", { name: "Opening the solution" })).toBeInTheDocument();
  });

  it("without an SDK a notice links to the setting", async () => {
    const { fake, user } = open({ ...READY, hasSdk: false });

    await user.click(await screen.findByRole("button", { name: "Open Settings" }));

    await waitFor(() => expect(fake.callsOf("openSettings")).toEqual([{ query: "nuget.dotnetPath" }]));
  });

  it("the view follows the session as it changes", async () => {
    const { fake } = open({ ...READY, backend: "starting" });
    await screen.findByText("Starting…");

    fake.emit("session", OPEN);

    expect(await screen.findByRole("button", { name: /Sample\.slnx/ })).toBeInTheDocument();
  });
});

describe("the side bar", () => {
  it("Settings opens the nuget settings and Help opens the documentation", async () => {
    const { fake, user } = open(OPEN);

    await user.click(await screen.findByRole("button", { name: "NuGet Settings" }));
    await user.click(screen.getByRole("button", { name: "Help" }));

    await waitFor(() => expect(fake.callsOf("openExternal")).toHaveLength(1));
    expect(fake.callsOf("openSettings")).toEqual([{ query: "nuget" }]);
    expect(fake.callsOf("openExternal")[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\//) });
  });
});
