import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getJson, HttpError, maskSecret } from "./utils.js";

describe("client utilities", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
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
