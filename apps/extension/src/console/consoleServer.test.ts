import { existsSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { ConsoleError, type ConsoleResponseMessage } from "@nuget-code/console-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startConsoleServer, type ConsoleHandlers, type RunningConsoleServer } from "./consoleServer";

const refuse = (): Promise<never> => Promise.reject(new Error("Not expected in this test."));

function handlers(overrides: Partial<ConsoleHandlers> = {}): ConsoleHandlers {
  return {
    projects: refuse,
    pickProject: refuse,
    installed: refuse,
    updates: refuse,
    search: refuse,
    details: refuse,
    vulnerabilities: refuse,
    plan: refuse,
    install: refuse,
    update: refuse,
    remove: refuse,
    restore: refuse,
    sources: refuse,
    cancel: refuse,
    ...overrides
  };
}

/** A console, for the test: writes lines and gathers the ones that come back. */
class TestConsole {
  readonly lines: ConsoleResponseMessage[] = [];
  closed = false;
  private pending = "";
  private waiting: (() => void)[] = [];

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.pending += chunk;
      const parts = this.pending.split("\n");
      this.pending = parts.pop() ?? "";
      this.lines.push(...parts.filter((part) => part !== "").map((part) => JSON.parse(part) as ConsoleResponseMessage));
      this.wake();
    });
    socket.on("close", () => {
      this.closed = true;
      this.wake();
    });
    socket.on("error", () => {});
  }

  static open(address: string): Promise<TestConsole> {
    return new Promise((resolve, reject) => {
      const socket = connect(address, () => resolve(new TestConsole(socket)));
      socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.write(`${typeof message === "string" ? message : JSON.stringify(message)}\n`);
  }

  /** Waits until the condition holds, which a line or the end of the connection may bring. */
  async until(condition: () => boolean): Promise<void> {
    while (!condition()) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
  }

  /** The line that ends the request: its result or its error. */
  async answerOf(id: number): Promise<ConsoleResponseMessage> {
    const done = (line: ConsoleResponseMessage): boolean => line.id === id && !("progress" in line);
    await this.until(() => this.lines.some(done) || this.closed);
    const line = this.lines.find(done);
    if (line === undefined) {
      throw new Error("The connection closed before the answer.");
    }

    return line;
  }

  close(): void {
    this.socket.destroy();
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) {
      resolve();
    }
  }
}

describe("the server of the console", () => {
  let server: RunningConsoleServer | undefined;
  const consoles: TestConsole[] = [];

  const start = async (
    overrides: Partial<ConsoleHandlers> = {}
  ): Promise<{ running: RunningConsoleServer; console: TestConsole }> => {
    server = await startConsoleServer(handlers(overrides));
    const opened = await TestConsole.open(server.address);
    consoles.push(opened);
    return { running: server, console: opened };
  };

  afterEach(async () => {
    for (const opened of consoles.splice(0)) {
      opened.close();
    }

    await server?.dispose();
    server = undefined;
  });

  it("a request with the token is answered with what the handler says", async () => {
    const { running, console } = await start({ projects: () => Promise.resolve({ projects: [] }) });

    console.send({ id: 1, token: running.token, method: "projects" });

    expect(await console.answerOf(1)).toEqual({ id: 1, result: { projects: [] } });
  });

  it.each([
    ["without a token", { id: 1, method: "projects" }],
    ["with another token", { id: 1, token: "0".repeat(64), method: "projects" }],
    ["with a token that is not a text", { id: 1, token: 7, method: "projects" }],
    ["that is not JSON", "projects"],
    ["that is not an object", "7"]
  ])("a line %s closes the connection and is not answered", async (_name, line) => {
    let asked = false;
    const { console } = await start({
      projects: () => {
        asked = true;
        return Promise.resolve({ projects: [] });
      }
    });

    console.send(line);

    await console.until(() => console.closed);
    expect(console.lines).toEqual([]);
    expect(asked).toBe(false);
  });

  it("a method outside the list is refused", async () => {
    const { running, console } = await start();

    console.send({ id: 4, token: running.token, method: "clearFolders", params: { paths: ["/"] } });

    expect(await console.answerOf(4)).toMatchObject({ id: 4, error: { code: "methodNotAllowed" } });
  });

  it("invalid params are refused before the handler is asked", async () => {
    let asked = false;
    const { running, console } = await start({
      remove: () => {
        asked = true;
        return refuse();
      }
    });

    console.send({ id: 2, token: running.token, method: "remove", params: { id: "Alpha", projects: [] } });

    expect(await console.answerOf(2)).toMatchObject({ id: 2, error: { code: "invalidParams" } });
    expect(asked).toBe(false);
  });

  it("the handler gets the params reduced to the fields of the request", async () => {
    let given: unknown;
    const { running, console } = await start({
      details: (params) => {
        given = params;
        return refuse();
      }
    });

    console.send({ id: 2, token: running.token, method: "details", params: { id: "Alpha", noCache: true } });

    await console.answerOf(2);
    expect(given).toEqual({ id: "Alpha", prerelease: false });
  });

  it("a change streams its steps and then its result", async () => {
    const result = { fellBack: false, projects: [] };
    const { running, console } = await start({
      install: async (_params, progress) => {
        progress({ step: "planning" });
        progress({ step: "restoring", project: "/a.csproj" });
        await Promise.resolve();
        return result;
      }
    });

    console.send({
      id: 9,
      token: running.token,
      method: "install",
      params: { id: "Alpha", version: "1.0.0", projects: ["/a.csproj"] }
    });

    await console.answerOf(9);
    expect(console.lines).toEqual([
      { id: 9, progress: { step: "planning" } },
      { id: 9, progress: { step: "restoring", project: "/a.csproj" } },
      { id: 9, result }
    ]);
  });

  it("a failure of the handler comes back as an error with its code and message", async () => {
    const { running, console } = await start({
      installed: () => Promise.reject(new ConsoleError("noSolution", "No solution is open in the editor.")),
      sources: () => Promise.reject(new Error("Something else."))
    });

    console.send({ id: 1, token: running.token, method: "installed" });
    console.send({ id: 2, token: running.token, method: "sources" });

    expect(await console.answerOf(1)).toEqual({
      id: 1,
      error: { code: "noSolution", message: "No solution is open in the editor." }
    });
    expect(await console.answerOf(2)).toEqual({ id: 2, error: { code: "internal", message: "Something else." } });
  });

  it("requests are answered by id, in whatever order they finish", async () => {
    let finishFirst = (): void => {};
    const { running, console } = await start({
      installed: () => new Promise((resolve) => (finishFirst = () => resolve({ projects: [] }))),
      cancel: () => Promise.resolve({})
    });

    console.send({ id: 1, token: running.token, method: "installed" });
    console.send({ id: 2, token: running.token, method: "cancel" });

    expect(await console.answerOf(2)).toEqual({ id: 2, result: {} });
    expect(console.lines).toHaveLength(1);
    finishFirst();
    expect(await console.answerOf(1)).toEqual({ id: 1, result: { projects: [] } });
  });

  it("a request without an id is told so", async () => {
    const { running, console } = await start();

    console.send({ token: running.token, method: "projects" });

    await console.until(() => console.lines.length > 0);
    expect(console.lines[0]).toMatchObject({ error: { code: "invalidRequest" } });
  });

  it("each server has its own address and token, and the endpoint is gone after dispose", async () => {
    const first = await startConsoleServer(handlers());
    const second = await startConsoleServer(handlers());
    try {
      expect(first.address).not.toBe(second.address);
      expect(first.token).not.toBe(second.token);
      expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await second.dispose();
    }

    const opened = await TestConsole.open(first.address);
    await first.dispose();

    await opened.until(() => opened.closed);
    await expect(TestConsole.open(first.address)).rejects.toThrow();
    if (process.platform !== "win32") {
      expect(existsSync(first.address)).toBe(false);
    }
  });
});
