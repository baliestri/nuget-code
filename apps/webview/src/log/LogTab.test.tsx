import type { SessionState } from "@nuget-code/bridge";
import type { LogEntry, LogLevel } from "@nuget-code/protocol";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFakeBridge, createMemoryStorage, READY } from "../../test/fakeBridge";
import { Root } from "../app/Root";

function entry(message: string, level: LogLevel = "info"): LogEntry {
  return { level, time: "2026-11-14T16:08:13-03:00", context: "VSCODE", message };
}

function open(stored: Record<string, unknown> = {}, session: SessionState | null = READY) {
  const fake = createFakeBridge(session);
  const storage = createMemoryStorage({ tab: "log", ...stored });
  render(<Root client={fake.client} storage={storage} />);
  const emit = async (...entries: LogEntry[]): Promise<void> => {
    await act(async () => {
      entries.forEach((item) => fake.emit("logEntry", item));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { fake, storage, emit, user: userEvent.setup() };
}

const log = (): HTMLElement => screen.getByRole("log", { name: "NuGet log" });
const lines = (): string[] => [...log().children].map((child) => child.textContent ?? "");

describe("Log", () => {
  it("entries from the backend appear as they arrive", async () => {
    const { emit } = open();
    await screen.findByRole("toolbar", { name: "Log" });

    await emit(entry("Opening the solution."));
    expect(lines()).toEqual(["16:08:13|VSCODE|INFOR| Opening the solution."]);

    await emit(entry("Restored.", "debug"));
    expect(lines()).toEqual(["16:08:13|VSCODE|INFOR| Opening the solution.", "16:08:13|VSCODE|DEBUG| Restored."]);
    expect(screen.getByText("2 lines")).toBeInTheDocument();
  });

  it("entries that arrive while another tab is shown are kept", async () => {
    const { emit, user } = open({ tab: "sources" });
    await screen.findByRole("tab", { name: "Log" });

    await emit(entry("Before the tab was opened."));
    await user.click(screen.getByRole("tab", { name: "Log" }));

    expect(lines()).toEqual(["16:08:13|VSCODE|INFOR| Before the tab was opened."]);
  });

  it("the log is shown while the backend is stopped", async () => {
    const { emit } = open({}, { ...READY, backend: "stopped" });
    await screen.findByRole("toolbar", { name: "Log" });

    await emit(entry("The backend exited with code 1.", "error"));

    expect(lines()).toEqual(["16:08:13|VSCODE|ERROR| The backend exited with code 1."]);
  });

  it("lines take the colour of their level", async () => {
    const { emit } = open();
    await screen.findByRole("toolbar", { name: "Log" });

    await emit(entry("bad", "error"), entry("careful", "warning"));

    expect(within(log()).getByText(/bad$/).className).toContain("text-error");
    expect(within(log()).getByText(/careful$/).className).toContain("text-warning");
  });

  it("the level filter is a multi-select", async () => {
    const { emit, user } = open();
    await screen.findByRole("toolbar", { name: "Log" });
    await emit(entry("d", "debug"), entry("i", "info"), entry("e", "error"));

    await user.click(screen.getByRole("button", { name: /^Level: All/ }));
    await user.click(screen.getByRole("checkbox", { name: "Debug" }));
    await user.click(screen.getByRole("checkbox", { name: "Info" }));

    expect(lines()).toEqual(["16:08:13|VSCODE|ERROR| e"]);
    expect(screen.getByRole("button", { name: /^Level: Verbose, Warning, Error/ })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 lines")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Debug" }));
    expect(lines()).toEqual(["16:08:13|VSCODE|DEBUG| d", "16:08:13|VSCODE|ERROR| e"]);
  });

  it("the three toggles hide and show their column", async () => {
    const { emit, user } = open();
    await screen.findByRole("toolbar", { name: "Log" });
    await emit(entry("m"));

    await user.click(screen.getByRole("button", { name: "Show Time" }));
    expect(lines()).toEqual(["VSCODE|INFOR| m"]);
    await user.click(screen.getByRole("button", { name: "Show Context" }));
    expect(lines()).toEqual(["INFOR| m"]);
    await user.click(screen.getByRole("button", { name: "Show Level" }));
    expect(lines()).toEqual(["m"]);
    await user.click(screen.getByRole("button", { name: "Show Time" }));

    expect(lines()).toEqual(["16:08:13| m"]);
    expect(screen.getByRole("button", { name: "Show Time" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Show Level" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Soft-Wrap wraps the lines", async () => {
    const { emit, user } = open();
    await screen.findByRole("toolbar", { name: "Log" });
    await emit(entry("m"));
    expect(log().firstElementChild?.className).toContain("whitespace-pre");

    await user.click(screen.getByRole("button", { name: "Soft-Wrap" }));

    expect(log().firstElementChild?.className).toContain("whitespace-pre-wrap");
  });

  it("Clear All empties the list", async () => {
    const { emit, user } = open();
    await screen.findByRole("toolbar", { name: "Log" });
    await emit(entry("a"), entry("b"));

    await user.click(screen.getByRole("button", { name: "Clear All" }));

    await waitFor(() => expect(lines()).toEqual([]));
    expect(screen.getByText("0 lines")).toBeInTheDocument();
  });

  it("Reload clears and keeps receiving", async () => {
    const { emit, user } = open();
    await screen.findByRole("toolbar", { name: "Log" });
    await emit(entry("old"));

    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(lines()).toEqual([]));
    await emit(entry("new"));

    expect(lines()).toEqual(["16:08:13|VSCODE|INFOR| new"]);
  });

  it("the toggles and the level filter are remembered", async () => {
    const { user, storage } = open();
    await screen.findByRole("toolbar", { name: "Log" });

    await user.click(screen.getByRole("button", { name: "Show Context" }));
    await user.click(screen.getByRole("button", { name: "Soft-Wrap" }));
    await user.click(screen.getByRole("button", { name: /^Level:/ }));
    await user.click(screen.getByRole("checkbox", { name: "Debug" }));

    await waitFor(() =>
      expect(storage.get()).toMatchObject({
        log: { time: true, context: false, level: true, wrap: true, levels: ["verbose", "info", "warning", "error"] }
      })
    );
  });

  it("remembered choices are applied when the view opens", async () => {
    const { emit } = open({ log: { time: false, context: false, level: true, wrap: false, levels: ["error"] } });
    await screen.findByRole("toolbar", { name: "Log" });

    await emit(entry("i"), entry("e", "error"));

    expect(lines()).toEqual(["ERROR| e"]);
    expect(screen.getByRole("button", { name: /^Level: Error/ })).toBeInTheDocument();
  });
});
