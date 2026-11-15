import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConsoleError,
  ConsoleErrorCodes,
  isConsoleRequest,
  validate,
  type ConsoleRequest,
  type ConsoleRequests,
  type ConsoleResponseMessage
} from "@nuget-code/console-protocol";
import type { OperationProgressParams } from "@nuget-code/protocol";

/** Answers one request of the console. `progress` reports the steps of the operation it started. */
export type ConsoleHandlers = {
  readonly [M in ConsoleRequest]: (
    params: ConsoleRequests[M]["params"],
    progress: (step: OperationProgressParams) => void
  ) => Promise<ConsoleRequests[M]["result"]>;
};

export interface RunningConsoleServer {
  /** Where the console connects: the name of a pipe on Windows, the path of a socket elsewhere. */
  address: string;
  /** What every request must carry. */
  token: string;
  dispose(): Promise<void>;
}

/** A request is one line; a longer one is not from the console. */
const LINE_LIMIT = 1024 * 1024;

/**
 * Listens for the Package Manager Console on an endpoint only this user can reach, with a random name.
 * A request is one line of JSON and is answered with one or more lines. Only the listed requests are
 * answered, and only with the token.
 */
export async function startConsoleServer(
  handlers: ConsoleHandlers,
  platform: string = process.platform
): Promise<RunningConsoleServer> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(token);
  const sockets = new Set<Socket>();

  // Elsewhere than on Windows the socket is a file: it goes in a folder of its own that only the user opens.
  const folder = platform === "win32" ? undefined : await mkdtemp(join(tmpdir(), "nuget-code-"));
  const address =
    folder === undefined ? `\\\\.\\pipe\\nuget-code-${randomBytes(16).toString("hex")}` : join(folder, "console.sock");

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // A console that goes away in the middle of an answer is not an error worth reporting.
    socket.on("error", () => socket.destroy());
    serve(socket, expected, handlers);
  });

  await listen(server, address);

  return {
    address,
    token,
    dispose: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (folder !== undefined) {
        await rm(folder, { recursive: true, force: true });
      }
    }
  };
}

function listen(server: Server, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serve(socket: Socket, expected: Buffer, handlers: ConsoleHandlers): void {
  let pending = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    pending += chunk;
    let end = pending.indexOf("\n");
    while (end >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (line !== "" && !accept(socket, line, expected, handlers)) {
        socket.destroy();
        return;
      }

      end = pending.indexOf("\n");
    }

    if (pending.length > LINE_LIMIT) {
      socket.destroy();
    }
  });
}

/** Starts answering the line. False when whoever wrote it is not the console, and the connection must go. */
function accept(socket: Socket, line: string, expected: Buffer, handlers: ConsoleHandlers): boolean {
  let message: { id?: unknown; token?: unknown; method?: unknown; params?: unknown };
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }

    message = parsed;
  } catch {
    return false;
  }

  if (!hasToken(message.token, expected)) {
    return false;
  }

  const send = (response: ConsoleResponseMessage): void => {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify(response)}\n`);
    }
  };

  const id = message.id;
  if (typeof id !== "number") {
    send({ id: 0, error: { code: ConsoleErrorCodes.invalidRequest, message: "A request needs a numeric 'id'." } });
    return true;
  }

  void answer(message.method, message.params, handlers, (progress) => send({ id, progress })).then(
    (result) => send({ id, result }),
    (error: unknown) =>
      send({
        id,
        error:
          error instanceof ConsoleError
            ? { code: error.code, message: error.message }
            : { code: ConsoleErrorCodes.internal, message: error instanceof Error ? error.message : String(error) }
      })
  );
  return true;
}

function hasToken(given: unknown, expected: Buffer): boolean {
  if (typeof given !== "string") {
    return false;
  }

  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function answer(
  method: unknown,
  params: unknown,
  handlers: ConsoleHandlers,
  progress: (step: OperationProgressParams) => void
): Promise<unknown> {
  if (!isConsoleRequest(method)) {
    throw new ConsoleError(ConsoleErrorCodes.methodNotAllowed, `The console cannot ask for '${String(method)}'.`);
  }

  const handler = handlers[method] as (
    params: unknown,
    progress: (step: OperationProgressParams) => void
  ) => Promise<unknown>;
  return await handler(validate(method, params), progress);
}
