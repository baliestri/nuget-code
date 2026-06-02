import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFeedHealth,
  getFeedJson,
  getServiceResource,
} from "./feed-http.js";
import { getFeedAuthorizationHeader } from "#client/credentials";
import { getJson, HttpError } from "#client/utils";
import type { NuGetClientLogger, NuGetClientSettings } from "./types.js";

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
      {
        timeoutMs: 100,
      },
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
