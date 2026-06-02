import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPackageDetails,
  loadPackageDetailsFromFeedCached,
  toFeedSummary,
} from "./package-details.js";
import { getFeedJson, getServiceResource } from "#client/feed-http";
import type { NuGetPackageItem } from "#contracts";
import type { NuGetClientLogger, NuGetClientSettings } from "./types.js";

vi.mock("#client/feed-http", () => ({
  getFeedJson: vi.fn(),
  getServiceResource: vi.fn(),
}));

describe("package details", () => {
  beforeEach(() => {
    vi.mocked(getFeedJson).mockReset();
    vi.mocked(getServiceResource).mockReset();
  });

  it("returns undefined without feed or for local feeds", async () => {
    const log = logger();
    await expect(
      loadPackageDetails({
        packageId: "Demo",
        feed: undefined,
        includePrerelease: false,
        settings: settings(),
        logger: log,
      }),
    ).resolves.toBeUndefined();

    await expect(
      loadPackageDetailsFromFeedCached(
        "DemoLocal",
        {
          id: "local",
          name: "Local",
          url: "c:/packages",
          enabled: true,
        },
        {
          includePrerelease: false,
          settings: settings(),
          logger: log,
        },
      ),
    ).resolves.toBeUndefined();
    expect(log.verbose).toHaveBeenCalledWith(
      "nuget.http",
      "Skipping details for non-HTTP source Local: c:/packages",
    );
  });

  it("loads package details from registration pages and filters prerelease", async () => {
    vi.mocked(getServiceResource).mockResolvedValue({
      "@id": "https://nuget/registration/",
      "@type": "RegistrationsBaseUrl",
    });
    vi.mocked(getFeedJson)
      .mockResolvedValueOnce({
        items: [
          {
            items: [
              {
                catalogEntry: {
                  id: "Demo",
                  version: "2.0.0-beta.1",
                },
              },
              {
                catalogEntry: {
                  id: "Demo",
                  version: "1.0.0",
                  authors: ["Alice", "Bob"],
                  tags: "json http",
                  dependencyGroups: [
                    {
                      targetFramework: "net8.0",
                      dependencies: [{ id: "Dep", range: "[1,2)" }],
                    },
                  ],
                  deprecation: { alternatePackage: { id: "NewDemo" } },
                },
              },
            ],
          },
          { "@id": "https://nuget/page2" },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            catalogEntry: {
              id: "Demo",
              version: "1.5.0",
              published: "2026-01-01",
            },
          },
        ],
      });

    const details = await loadPackageDetailsFromFeedCached(
      "DemoDetails",
      feed("nuget"),
      {
        includePrerelease: false,
        settings: settings(),
        logger: logger(),
      },
    );

    expect(details).toMatchObject({
      id: "nuget:DemoDetails",
      name: "Demo",
      availableVersion: "1.5.0",
      authors: undefined,
      versions: [
        { version: "1.0.0", source: "nuget.org" },
        { version: "1.5.0", source: "nuget.org" },
      ],
    });
    expect(details?.dependencyGroups).toEqual([]);
  });

  it("returns undefined and logs when registration is missing or fails", async () => {
    const log = logger();
    vi.mocked(getServiceResource).mockResolvedValueOnce({});
    await expect(
      loadPackageDetailsFromFeedCached("NoRegistration", feed("nuget"), {
        settings: settings(),
        logger: log,
      }),
    ).resolves.toBeUndefined();
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.http",
      "nuget.org has no RegistrationsBaseUrl",
    );

    vi.mocked(getServiceResource).mockRejectedValueOnce(new Error("offline"));
    await expect(
      loadPackageDetailsFromFeedCached("ThrowsRegistration", feed("nuget"), {
        settings: settings(),
        logger: log,
      }),
    ).resolves.toBeUndefined();
    expect(log.warning).toHaveBeenCalledWith(
      "nuget.http",
      "Failed to load details for ThrowsRegistration from nuget.org: offline",
    );
  });

  it("does not log warnings for aborted detail loads", async () => {
    const log = logger();
    const abort = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    vi.mocked(getServiceResource).mockRejectedValueOnce(abort);

    await expect(
      loadPackageDetailsFromFeedCached("AbortDetails", feed("nuget"), {
        settings: settings(),
        logger: log,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(log.warning).not.toHaveBeenCalled();
  });

  it("does not cache missing details so later authenticated refreshes can retry", async () => {
    const log = logger();
    vi.mocked(getServiceResource)
      .mockRejectedValueOnce(new Error("401"))
      .mockResolvedValueOnce({
        "@id": "https://nuget/registration/",
        "@type": "RegistrationsBaseUrl",
      });
    vi.mocked(getFeedJson).mockResolvedValueOnce({
      items: [
        {
          items: [
            {
              catalogEntry: {
                id: "RetryDetails",
                version: "1.0.0",
              },
            },
          ],
        },
      ],
    });

    await expect(
      loadPackageDetailsFromFeedCached("RetryDetails", feed("nuget"), {
        settings: settings(),
        logger: log,
      }),
    ).resolves.toBeUndefined();

    await expect(
      loadPackageDetailsFromFeedCached("RetryDetails", feed("nuget"), {
        settings: settings(),
        logger: log,
      }),
    ).resolves.toMatchObject({
      name: "RetryDetails",
      availableVersion: "1.0.0",
    });

    expect(getServiceResource).toHaveBeenCalledTimes(2);
  });

  it("uses injected persisted details before hitting the feed", async () => {
    const cache = new Map<string, NuGetPackageItem>([
      [
        "nuget:cached:true",
        {
          id: "nuget:Cached",
          name: "Cached",
          availableVersion: "1.0.0",
          projectPaths: [],
          versions: [],
          dependencyGroups: [],
        },
      ],
    ]);

    await expect(
      loadPackageDetailsFromFeedCached("Cached", feed("nuget"), {
        includePrerelease: true,
        cache: {
          get: (key) => cache.get(key),
          set: (key, value) => {
            cache.set(key, value);
          },
        },
        settings: settings(),
        logger: logger(),
      }),
    ).resolves.toMatchObject({
      name: "Cached",
      availableVersion: "1.0.0",
    });

    expect(getServiceResource).not.toHaveBeenCalled();
  });

  it("summarizes feeds with display name and color", () => {
    expect(
      toFeedSummary({
        id: "offline",
        name: "Microsoft Visual Studio Offline Packages",
        url: "c:/packages",
        enabled: true,
      }),
    ).toMatchObject({
      id: "offline",
      displayName: "VS Offline",
      color: "#c586c0",
    });
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
