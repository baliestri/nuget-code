import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchPackages } from "./package-search.js";
import { getFeedJson, getServiceResource } from "#client/feed-http";
import type { NuGetClientLogger, NuGetClientSettings } from "./types.js";

vi.mock("#client/feed-http", () => ({
  getFeedJson: vi.fn(),
  getServiceResource: vi.fn(),
}));

describe("package search", () => {
  beforeEach(() => {
    vi.mocked(getFeedJson).mockReset();
    vi.mocked(getServiceResource).mockReset();
  });

  it("searches enabled HTTP feeds, filters prerelease versions, and merges results", async () => {
    vi.mocked(getServiceResource).mockResolvedValue({
      "@id": "https://nuget/search",
      "@type": "SearchQueryService",
    });
    vi.mocked(getFeedJson)
      .mockResolvedValueOnce({
        data: [
          {
            id: "Demo",
            version: "2.0.0-beta.1",
            description: "Preview",
            authors: ["A", "B"],
            tags: ["json"],
            versions: [{ version: "1.0.0" }, { version: "2.0.0-beta.1" }],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "Demo",
            version: "1.5.0",
            authors: "C",
            versions: [{ version: "1.5.0" }],
          },
        ],
      });

    const results = await searchPackages({
      feeds: [
        feed("nuget"),
        feed("private"),
        { ...feed("off"), enabled: false },
      ],
      selectedFeedId: "__all__",
      query: "demo",
      includePrerelease: false,
      settings: settings(),
      logger: logger(),
    });

    expect(getFeedJson).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "nuget:Demo",
      name: "Demo",
      availableVersion: "1.0.0",
      sourceName: "nuget.org, private",
    });
    expect(results[0]?.versions.map((version) => version.version)).toEqual([
      "1.0.0",
      "1.5.0",
    ]);
  });

  it("logs skipped and unhealthy feeds", async () => {
    const log = logger();
    vi.mocked(getServiceResource).mockResolvedValue(undefined);

    await expect(
      searchPackages({
        feeds: [
          { id: "local", name: "Local", url: "c:/packages", enabled: true },
          feed("nuget"),
        ],
        selectedFeedId: "__all__",
        query: "",
        includePrerelease: true,
        settings: settings(),
        logger: log,
      }),
    ).resolves.toEqual([]);

    expect(log.verbose).toHaveBeenCalledWith(
      "nuget.http",
      "Skipping non-HTTP source Local: c:/packages",
    );
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.http",
      "nuget.org has no SearchQueryService",
    );
  });

  it("returns selected feed results and swallows feed failures", async () => {
    const log = logger();
    vi.mocked(getServiceResource).mockRejectedValue(new Error("offline"));

    await expect(
      searchPackages({
        feeds: [feed("nuget"), feed("private")],
        selectedFeedId: "private",
        query: "demo",
        includePrerelease: true,
        settings: settings(),
        logger: log,
      }),
    ).resolves.toEqual([]);

    expect(getServiceResource).toHaveBeenCalledTimes(1);
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.http",
      "Failed to search private: offline",
    );
  });

  it("does not log warnings for aborted searches", async () => {
    const log = logger();
    const abort = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    vi.mocked(getServiceResource).mockRejectedValue(abort);

    await expect(
      searchPackages({
        feeds: [feed("nuget")],
        selectedFeedId: "__all__",
        query: "demo",
        includePrerelease: true,
        settings: settings(),
        logger: log,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(log.warning).not.toHaveBeenCalled();
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
