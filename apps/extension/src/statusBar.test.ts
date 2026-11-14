import { describe, expect, it } from "vitest";
import { Commands, StatusBar, statusText, type StatusItem } from "./statusBar";

describe("statusText", () => {
  it("a stopped backend says so as an error and restarts on click, whatever the solution", () => {
    const status = statusText("stopped", { kind: "open", name: "Sample.slnx" });

    expect(status.text).toBe("$(error) NuGet: stopped");
    expect(status.command).toBe(Commands.restartBackend);
    expect(status.error).toBe(true);
  });

  it("a starting backend spins and says it is starting", () => {
    const status = statusText("starting", { kind: "none" });

    expect(status.text).toBe("$(sync~spin) NuGet: starting…");
    expect(status.error).toBe(false);
  });

  it("a solution being opened spins and says it is opening", () => {
    expect(statusText("ready", { kind: "opening" }).text).toBe("$(sync~spin) NuGet: opening…");
  });

  it("an open solution shows its file name, and the tooltip says the backend is running", () => {
    const status = statusText("ready", { kind: "open", name: "Sample.slnx" });

    expect(status.text).toBe("$(package) Sample.slnx");
    expect(status.tooltip).toContain("running");
    expect(status.command).toBe(Commands.open);
    expect(status.error).toBe(false);
  });

  it("while it starts or opens, a click opens the view", () => {
    expect(statusText("starting", { kind: "none" }).command).toBe(Commands.open);
    expect(statusText("ready", { kind: "opening" }).command).toBe(Commands.open);
  });

  it("no solution asks for one", () => {
    const status = statusText("ready", { kind: "none" });

    expect(status.text).toBe("$(package) NuGet: select a solution");
    expect(status.command).toBe(Commands.selectSolution);
  });
});

describe("StatusBar", () => {
  function item(): StatusItem & { shown: number } {
    const value = {
      text: "",
      tooltip: "",
      command: "",
      backgroundColor: undefined as unknown,
      shown: 0,
      show: () => value.shown++
    };
    return value;
  }

  it("applies the text, tooltip and command to the item and shows it", () => {
    const target = item();

    new StatusBar(target, "error-colour").update("ready", { kind: "open", name: "App.sln" });

    expect(target.text).toBe("$(package) App.sln");
    expect(target.command).toBe(Commands.open);
    expect(target.tooltip).not.toBe("");
    expect(target.backgroundColor).toBeUndefined();
    expect(target.shown).toBe(1);
  });

  it("a stopped backend takes the error colour, and loses it when it runs again", () => {
    const target = item();
    const bar = new StatusBar(target, "error-colour");

    bar.update("stopped", { kind: "none" });
    expect(target.backgroundColor).toBe("error-colour");

    bar.update("ready", { kind: "none" });
    expect(target.backgroundColor).toBeUndefined();
  });
});
