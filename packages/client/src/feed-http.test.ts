import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFeedHealth,
  getFeedJson,
  getServiceResource,
} from "./feed-http.js";
import { getFeedAuthorizationHeader } from "#client/credentials";
import { getJson, HttpError } from "#client/utils";
import type { NuGetClientLogger, NuGetClientSettings } from "./types.js";
import { ClientNetwork } from "./client-network";
import http from "node:http";

vi.mock("#client/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#client/credentials")>();
  return {
    ...actual,
    getFeedAuthorizationHeader: vi.fn(),
  };
});

vi.mock("#client/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#client/utils")>();
  return {
    ...actual,
    getJson: vi.fn(),
  };
});

describe("feed HTTP helpers", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset();
    vi.mocked(getFeedAuthorizationHeader).mockReset();
  });

  it("shares transport work only within the same authentication context", async () => {
    const network = new ClientNetwork();
    const shared = { ...settings(), network };
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const responses: http.ServerResponse[] = [];
    const server = http.createServer((_request, response) => {
      responses.push(response);
      if (responses.length === 2) ready();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const actual =
      await vi.importActual<typeof import("#client/utils")>("#client/utils");
    vi.mocked(getJson).mockImplementation(actual.getJson);
    const controller = new AbortController();
    const options = {
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      feed: feed("nuget"),
      settings: shared,
      logger: logger(),
    };
    try {
      const a = getFeedJson({ ...options, signal: controller.signal });
      const b = getFeedJson(options);
      const c = getFeedJson({ ...options, settings: { ...shared } });
      const rejected = expect(a).rejects.toMatchObject({ name: "AbortError" });
      await gate;
      controller.abort();
      await rejected;
      expect(network.requests.metrics().started).toBe(2);
      expect(network.requests.metrics().deduplicated).toBe(1);
      for (const response of responses) response.end('{"ok":true}');
      expect(await b).toEqual({ ok: true });
      expect(await c).toEqual({ ok: true });
    } finally {
      network.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("checks feed health for non-HTTP, valid, invalid, and failing feeds", async () => {
    await expect(
      checkFeedHealth({
        feed: { id: "local", name: "Local", url: "c:/packages", enabled: true },
        settings: settings(),
        logger: logger(),
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ ok: true });

    vi.mocked(getJson).mockResolvedValueOnce({ resources: [] });
    await expect(
      checkFeedHealth({
        feed: feed("nuget"),
        settings: settings(),
        logger: logger(),
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ ok: true });

    vi.mocked(getJson).mockResolvedValueOnce({});
    await expect(
      checkFeedHealth({
        feed: feed("nuget"),
        settings: settings(),
        logger: logger(),
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ ok: false, error: "Invalid feed service index" });

    vi.mocked(getJson).mockRejectedValueOnce(new Error("offline"));
    await expect(
      checkFeedHealth({
        feed: feed("nuget"),
        settings: settings(),
        logger: logger(),
        timeoutMs: 1,
      }),
    ).resolves.toEqual({ ok: false, error: "offline" });
  });

  it("finds service resources by type prefix", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      resources: [
        { "@id": "https://nuget/search", "@type": "SearchQueryService/3.5.0" },
      ],
    });

    await expect(
      getServiceResource(
        feed("nuget"),
        "searchqueryservice",
        settings(),
        logger(),
      ),
    ).resolves.toEqual({
      "@id": "https://nuget/search",
      "@type": "SearchQueryService/3.5.0",
    });
  });

  it("passes through feed JSON requests that do not require authentication", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({ ok: true });
    await expect(
      getFeedJson({
        url: "https://nuget/index.json",
        feed: feed("nuget"),
        settings: { ...settings(), proxy: "http://proxy" },
        logger: logger(),
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ ok: true });

    expect(getJson).toHaveBeenCalledWith(
      "https://nuget/index.json",
      "http://proxy",
      expect.objectContaining({
        timeoutMs: 100,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("authenticates feeds after 401 and retries rejected credentials once", async () => {
    vi.mocked(getFeedAuthorizationHeader)
      .mockResolvedValueOnce({
        authorizationHeader: "Basic first",
        providerFound: true,
      })
      .mockResolvedValueOnce({
        authorizationHeader: "Basic retry",
        providerFound: true,
      });
    vi.mocked(getJson)
      .mockRejectedValueOnce(new HttpError(401))
      .mockRejectedValueOnce(new HttpError(401))
      .mockResolvedValueOnce({ ok: true });

    await expect(
      getFeedJson({
        url: "https://packages.example.test/feed/index.json",
        feed: {
          id: "private",
          name: "Private",
          url: "https://packages.example.test/feed/index.json",
          enabled: true,
        },
        settings: settings(),
        logger: logger(),
      }),
    ).resolves.toEqual({ ok: true });

    expect(getFeedAuthorizationHeader).toHaveBeenLastCalledWith(
      expect.objectContaining({ retry: true }),
    );
    expect(getJson).toHaveBeenLastCalledWith(
      expect.any(String),
      "",
      expect.objectContaining({
        headers: { Authorization: "Basic retry" },
      }),
    );
  });

  it("throws auth errors when credentials are unavailable", async () => {
    vi.mocked(getJson).mockRejectedValueOnce(new HttpError(401));
    vi.mocked(getFeedAuthorizationHeader).mockResolvedValueOnce({
      providerFound: false,
      error: "missing",
    });

    await expect(
      getFeedJson({
        url: "https://packages.example.test/feed/index.json",
        feed: {
          id: "private",
          name: "Private",
          url: "https://packages.example.test/feed/index.json",
          enabled: true,
        },
        settings: settings(),
        logger: logger(),
      }),
    ).rejects.toThrow("NuGet credential provider was not found");
  });

  it("does not recover another origin's challenge with this feed's credentials", async () => {
    vi.mocked(getJson).mockRejectedValueOnce(
      new HttpError(401, undefined, null, false),
    );
    await expect(
      getFeedJson({
        url: "https://nuget/index.json",
        feed: feed("nuget"),
        settings: settings(),
        logger: logger(),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(getFeedAuthorizationHeader).not.toHaveBeenCalled();
  });

  it("includes credential-provider waiting in the query deadline and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(getJson).mockRejectedValueOnce(new HttpError(401));
      vi.mocked(getFeedAuthorizationHeader).mockImplementation(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            });
          }),
      );
      const pending = getFeedJson({
        url: "https://nuget/index.json",
        feed: feed("nuget"),
        settings: settings(),
        logger: logger(),
        timeoutMs: 100,
      });
      const rejected = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(getFeedAuthorizationHeader).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function feed(id: string) {
  return {
    id,
    name: id === "nuget" ? "nuget.org" : id,
    url: `https://${id}/index.json`,
    enabled: true,
  };
}

function settings(): NuGetClientSettings {
  return {
    dotnetPath: "dotnet",
    nugetPath: "nuget",
    extraConfigPaths: [],
    credentialProviderPaths: [],
    proxy: "",
    maxSearchResults: 10,
  };
}

function logger(): NuGetClientLogger {
  return {
    verbose: vi.fn(),
    information: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}
