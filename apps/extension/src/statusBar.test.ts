import { describe, expect, it } from "vitest";
import { Commands, StatusBar, statusText, type StatusItem } from "./statusBar";

describe("statusText", () => {
  it("a stopped backend shows the error and restarts on click, whatever the solution", () => {
    const status = statusText("stopped", { kind: "open", name: "Sample.slnx" });

    expect(status.text).toBe("$(error) NuGet");
    expect(status.command).toBe(Commands.restartBackend);
  });

  it("a starting backend spins", () => {
    expect(statusText("starting", { kind: "none" }).text).toBe("$(sync~spin) NuGet");
  });

  it("a solution being opened spins", () => {
    expect(statusText("ready", { kind: "opening" }).text).toBe("$(sync~spin) NuGet");
  });

  it("an open solution shows its file name", () => {
    const status = statusText("ready", { kind: "open", name: "Sample.slnx" });

    expect(status.text).toBe("$(package) Sample.slnx");
    expect(status.command).toBe(Commands.open);
  });

  it("while it starts or opens, a click opens the view", () => {
    expect(statusText("starting", { kind: "none" }).command).toBe(Commands.open);
    expect(statusText("ready", { kind: "opening" }).command).toBe(Commands.open);
  });

  it("no solution asks for one", () => {
    const status = statusText("ready", { kind: "none" });

    expect(status.text).toBe("$(package) Select Solution");
    expect(status.command).toBe(Commands.selectSolution);
  });
});

describe("StatusBar", () => {
  it("applies the text, tooltip and command to the item and shows it", () => {
    let shown = 0;
    const item: StatusItem = { text: "", tooltip: "", command: "", show: () => shown++ };

    new StatusBar(item).update("ready", { kind: "open", name: "App.sln" });

    expect(item.text).toBe("$(package) App.sln");
    expect(item.command).toBe(Commands.open);
    expect(item.tooltip).not.toBe("");
    expect(shown).toBe(1);
  });
});
