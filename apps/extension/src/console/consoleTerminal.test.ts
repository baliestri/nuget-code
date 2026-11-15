import type { ConsoleProject } from "@nuget-code/console-protocol";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_NAME,
  PackageManagerConsole,
  shellArguments,
  type ConsoleDeps,
  type ConsoleTerminalOptions
} from "./consoleTerminal";
import type { PowerShellLocation } from "./powershellLocator";

const APP: ConsoleProject = { name: "App", path: "/work/App/App.csproj", frameworks: ["net10.0"] };
const LIB: ConsoleProject = { name: "Lib", path: "/work/Lib/Lib.csproj", frameworks: ["net8.0"] };
const PWSH = "/usr/bin/pwsh";
const MANIFEST = "/ext/console/NuGetCode.psd1";

interface FakeTerminal {
  options: ConsoleTerminalOptions;
}

interface Setup {
  enabled?: boolean;
  projects?: readonly ConsoleProject[] | null;
  picked?: string | null;
  manifest?: string | null;
  location?: PowerShellLocation;
  installed?: string;
  serverFails?: number;
}

function setup(options: Setup = {}) {
  const log: string[] = [];
  const terminals: FakeTerminal[] = [];
  let servers = 0;
  let failures = options.serverFails ?? 0;
  const deps: ConsoleDeps<FakeTerminal> = {
    enabled: () => options.enabled ?? true,
    projects: () => (options.projects === null ? undefined : (options.projects ?? [APP, LIB])),
    pickProject: (projects) => {
      log.push(`pick(${projects.map((project) => project.name).join(", ")})`);
      return Promise.resolve(options.picked === null ? undefined : (options.picked ?? LIB.path));
    },
    manifest: () => (options.manifest === null ? undefined : (options.manifest ?? MANIFEST)),
    locatePowerShell: () => Promise.resolve(options.location ?? { kind: "found", path: PWSH, version: "7.6.0" }),
    withoutPowerShell: (location) => {
      log.push(`withoutPowerShell(${location.kind})`);
      return Promise.resolve(options.installed);
    },
    startServer: () => {
      servers++;
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error("The pipe is taken."));
      }

      return Promise.resolve({ address: `/tmp/console-${servers}.sock`, token: "secret" });
    },
    createTerminal: (given) => {
      const terminal = { options: given };
      terminals.push(terminal);
      log.push("create");
      return terminal;
    },
    show: (terminal) => void log.push(`show(${terminals.indexOf(terminal)})`),
    explain: (message) => void log.push(`explain: ${message}`),
    platform: "linux"
  };
  return { console: new PackageManagerConsole(deps), log, terminals, servers: () => servers };
}

describe("opening the console", () => {
  it("asks for the project when the solution has more than one, and starts the shell with it", async () => {
    const { console, log, terminals } = setup();

    await console.open();

    expect(log).toEqual(["pick(App, Lib)", "create", "show(0)"]);
    expect(terminals[0]!.options).toEqual({
      name: CONSOLE_NAME,
      shellPath: PWSH,
      shellArgs: ["-NoLogo", "-NoExit", "-Command", `Import-Module '${MANIFEST}'`],
      env: {
        NUGET_CODE_CONSOLE_ADDRESS: "/tmp/console-1.sock",
        NUGET_CODE_CONSOLE_TOKEN: "secret",
        NUGET_CODE_CONSOLE_PROJECT: LIB.path
      }
    });
  });

  it("dismissing the list opens nothing, and does not start listening", async () => {
    const { console, log, terminals, servers } = setup({ picked: null });

    await console.open();

    expect(log).toEqual(["pick(App, Lib)"]);
    expect(terminals).toEqual([]);
    expect(servers()).toBe(0);
  });

  it("a solution with one project is not asked about", async () => {
    const { console, log, terminals } = setup({ projects: [APP] });

    await console.open();

    expect(log).toEqual(["create", "show(0)"]);
    expect(terminals[0]!.options.env["NUGET_CODE_CONSOLE_PROJECT"]).toBe(APP.path);
  });

  it("a solution without projects opens the console without a default project", async () => {
    const { console, terminals } = setup({ projects: [] });

    await console.open();

    expect(terminals[0]!.options.env["NUGET_CODE_CONSOLE_PROJECT"]).toBe("");
  });

  it("opening again shows the console that exists, without asking or listening again", async () => {
    const { console, log, terminals, servers } = setup();
    await console.open();
    log.length = 0;

    await console.open();

    expect(log).toEqual(["show(0)"]);
    expect(terminals).toHaveLength(1);
    expect(servers()).toBe(1);
  });

  it("two requests at once open one console", async () => {
    const { console, terminals } = setup();

    await Promise.all([console.open(), console.open()]);

    expect(terminals).toHaveLength(1);
  });

  it("closing the terminal lets a new one open, on the same channel", async () => {
    const { console, terminals, servers } = setup();
    await console.open();

    console.closed({ options: terminals[0]!.options });
    await console.open();
    expect(terminals).toHaveLength(1);

    console.closed(terminals[0]!);
    await console.open();

    expect(terminals).toHaveLength(2);
    expect(servers()).toBe(1);
    expect(console.isConsole(terminals[1]!)).toBe(true);
    expect(console.isConsole(terminals[0]!)).toBe(false);
  });

  it("without a solution the reason is said and nothing opens", async () => {
    const { console, log } = setup({ projects: null });

    await console.open();

    expect(log).toEqual(["explain: The Package Manager Console works on a solution. Select one first."]);
  });

  it("with the console turned off the reason is said and nothing opens", async () => {
    const { console, log } = setup({ enabled: false });

    await console.open();

    expect(log).toEqual([
      "explain: The Package Manager Console is turned off. Turn nuget.console.enabled on to use it."
    ]);
  });

  it("without the module in the extension the reason is said", async () => {
    const { console, log } = setup({ manifest: null });

    await console.open();

    expect(log).toEqual([
      "explain: The module of the Package Manager Console was not found in the extension. Reinstall it."
    ]);
  });

  it("without PowerShell the user is told before any project is asked about, and nothing opens", async () => {
    const { console, log } = setup({ location: { kind: "missing" } });

    await console.open();

    expect(log).toEqual(["withoutPowerShell(missing)"]);
  });

  it("a PowerShell installed from the notice is the one the console starts with", async () => {
    const tool = "/home/dev/.dotnet/tools/pwsh";
    const { console, log, terminals } = setup({
      location: { kind: "tooOld", path: PWSH, version: "7.4.6" },
      installed: tool
    });

    await console.open();

    expect(log).toEqual(["withoutPowerShell(tooOld)", "pick(App, Lib)", "create", "show(0)"]);
    expect(terminals[0]!.options.shellPath).toBe(tool);
  });

  it("a channel that could not be started is said, and tried again the next time", async () => {
    const { console, log, terminals, servers } = setup({ serverFails: 1 });

    await console.open();
    expect(log.at(-1)).toBe("explain: The Package Manager Console could not be started. The pipe is taken.");
    expect(terminals).toEqual([]);

    await console.open();

    expect(terminals).toHaveLength(1);
    expect(servers()).toBe(2);
  });

  it("focus brings the console to the front, and does nothing without one", async () => {
    const { console, log } = setup();
    console.focus();
    expect(log).toEqual([]);

    await console.open();
    log.length = 0;
    console.focus();

    expect(log).toEqual(["show(0)"]);
  });
});

describe("the console as a terminal profile", () => {
  it("gives the editor what to start, and the terminal it then opens is the console", async () => {
    const { console, log, terminals } = setup();

    const options = await console.profile();
    const made = { options: options! };
    console.opened({ options: options! }, "pwsh");
    console.opened(made, CONSOLE_NAME);

    expect(options?.name).toBe(CONSOLE_NAME);
    expect(terminals).toEqual([]);
    expect(console.isConsole(made)).toBe(true);

    log.length = 0;
    await console.open();
    expect(log).toEqual(["show(-1)"]);
  });

  it("gives nothing when the console is open, and shows it", async () => {
    const { console, log } = setup();
    await console.open();
    log.length = 0;

    expect(await console.profile()).toBeUndefined();
    expect(log).toEqual(["show(0)"]);
  });

  it("a terminal of that name the profile did not ask for is not taken for the console", async () => {
    const { console } = setup();
    const stranger = { options: {} as ConsoleTerminalOptions };

    console.opened(stranger, CONSOLE_NAME);

    expect(console.isConsole(stranger)).toBe(false);
  });
});

describe("the arguments of the shell", () => {
  it("on Windows the execution policy is given to the process, because the module is not signed", () => {
    expect(shellArguments("C:\\ext\\console\\NuGetCode.psd1", "win32")).toEqual([
      "-NoLogo",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Import-Module 'C:\\ext\\console\\NuGetCode.psd1'"
    ]);
  });

  it("a quote in the path cannot end the text it is written in", () => {
    expect(shellArguments("/home/o'brien/ext/NuGetCode.psd1", "linux").at(-1)).toBe(
      "Import-Module '/home/o''brien/ext/NuGetCode.psd1'"
    );
  });
});
