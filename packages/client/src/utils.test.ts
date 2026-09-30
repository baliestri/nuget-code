import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, HttpError, maskSecret } from "./utils.js";
import { ClientNetwork } from "./client-network";

describe("client utilities", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    servers.length = 0;
  });

  it("masks secret-looking CLI arguments", () => {
    expect(maskSecret("Password=abc")).toBe("******");
    expect(maskSecret("--token")).toBe("******");
    expect(maskSecret("normal")).toBe("normal");
  });

  it("loads JSON, follows redirects, and rejects HTTP failures", async () => {
    const server = await listen((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/json" });
        response.end();
        return;
      }
      if (request.url === "/json") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    const baseUrl = `http://127.0.0.1:${address(server)}`;
    await expect(getJson(`${baseUrl}/redirect`, "")).resolves.toEqual({
      ok: true,
    });
    await expect(getJson(`${baseUrl}/missing`, "")).rejects.toEqual(
      new HttpError(404),
    );
  });

  it("rejects invalid JSON", async () => {
    const server = await listen((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{");
    });

    await expect(
      getJson(`http://127.0.0.1:${address(server)}`, ""),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects immediately when aborted before the request starts", async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(
      getJson("http://127.0.0.1:9", "", { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("drops credentials on cross-origin redirects and forbids credential recovery there", async () => {
    let received: http.IncomingHttpHeaders = {};
    const target = await listen((request, response) => {
      received = request.headers;
      response.writeHead(401);
      response.end();
    });
    const origin = await listen((_request, response) => {
      response.writeHead(302, {
        Location: `http://127.0.0.1:${address(target)}/private`,
      });
      response.end();
    });
    await expect(
      getJson(`http://127.0.0.1:${address(origin)}`, "", {
        headers: { authorization: "Bearer secret", Cookie: "session=secret" },
      }),
    ).rejects.toMatchObject({ statusCode: 401, authenticationAllowed: false });
    expect(received.authorization).toBeUndefined();
    expect(received.cookie).toBeUndefined();
  });

  it("bounds redirect loops and retries 429 with Retry-After", async () => {
    let loops = 0;
    let requests = 0;
    const server = await listen((request, response) => {
      if (request.url === "/loop") {
        loops++;
        response.writeHead(302, { Location: "/loop" });
      } else if (++requests === 1)
        response.writeHead(429, { "Retry-After": "0" });
      else {
        response.end('{"ok":true}');
        return;
      }
      response.end();
    });
    await expect(
      getJson(`http://127.0.0.1:${address(server)}/loop`, ""),
    ).rejects.toThrow("redirect limit");
    expect(loops).toBe(6);
    expect(
      await getJson(`http://127.0.0.1:${address(server)}/retry`, ""),
    ).toEqual({ ok: true });
    expect(requests).toBe(2);
  });

  it("enforces a wall-clock budget even while response bytes keep arriving", async () => {
    const server = await listen((_request, response) => {
      response.writeHead(200);
      response.write("[");
      const timer = setInterval(() => response.write(" "), 5);
      response.on("close", () => clearInterval(timer));
    });
    await expect(
      getJson(`http://127.0.0.1:${address(server)}`, "", {
        deadlineAt: Date.now() + 60,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("counts time in the queue against the total budget without starting HTTP", async () => {
    vi.useFakeTimers();
    const network = new ClientNetwork();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = Array.from({ length: 6 }, (_, i) =>
      network.requests.run(String(i), () => gate),
    );
    await Promise.resolve();
    const pending = getJson("http://127.0.0.1:9", "", {
      network,
      deadlineAt: Date.now() + 100,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(network.requests.metrics().started).toBe(6);
    release();
    await Promise.all(active);
    network.dispose();
  });

  it("releases slots on interrupted responses and retries transient failures", async () => {
    let attempts = 0;
    const network = new ClientNetwork();
    const server = await listen((_request, response) => {
      if (++attempts < 3) {
        response.writeHead(200);
        response.write("{");
        response.destroy();
      } else response.end('{"ok":true}');
    });
    expect(
      await getJson(`http://127.0.0.1:${address(server)}`, "", { network }),
    ).toEqual({ ok: true });
    expect(attempts).toBe(3);
    expect(network.requests.metrics()).toMatchObject({
      active: 0,
      peak: 1,
      started: 3,
    });
    network.dispose();
  });

  async function listen(handler: http.RequestListener): Promise<http.Server> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return server;
  }

  function address(server: http.Server): number {
    const current = server.address();
    if (typeof current === "object" && current) {
      return current.port;
    }
    throw new Error("Server has no port");
  }
});
