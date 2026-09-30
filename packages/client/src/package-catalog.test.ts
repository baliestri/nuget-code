import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PackageFeed } from "#contracts";
import { loadPackageCatalog } from "./package-catalog";
import { writeNupkg } from "./test/nupkg-fixture";

const settings = {
  dotnetPath: "dotnet",
  nugetPath: "nuget",
  credentialProviderPaths: [],
  extraConfigPaths: [],
  proxy: "",
  maxSearchResults: 100,
};
const logger = {
  error: vi.fn(),
  warning: vi.fn(),
  verbose: vi.fn(),
  information: vi.fn(),
};
const leaf = (version: string, listed?: boolean) => ({
  catalogEntry: {
    id: "Demo",
    version,
    ...(listed === undefined ? {} : { listed }),
  },
});
const feed = (url: string, enabled = true): PackageFeed => ({
  id: url,
  name: url,
  url,
  enabled,
});

describe("version catalogs", () => {
  it("accepts legacy Unicode package IDs instead of imposing gallery-only ASCII restrictions", async () => {
    expect(
      await loadPackageCatalog({
        packageId: "Pacoté",
        feeds: [],
        settings,
        logger,
      }),
    ).toMatchObject({ packageId: "pacoté", complete: true });
  });

  it.each(["../Demo", "Demo/Core", "Demo..Core", "a".repeat(101)])(
    "rejects an invalid package ID %s",
    async (packageId) => {
      await expect(
        loadPackageCatalog({ packageId, feeds: [], settings, logger }),
      ).rejects.toThrow("Invalid NuGet package ID");
    },
  );

  const roots: string[] = [];
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    );
    await Promise.all(
      roots
        .splice(0)
        .map((root) =>
          fs.rm(root, { recursive: true, force: true, maxRetries: 5 }),
        ),
    );
  });
  async function serve(
    handler: (url: string, base: string, response: http.ServerResponse) => void,
  ): Promise<string> {
    let base = "";
    const server = http.createServer((request, response) =>
      handler(request.url ?? "/", base, response),
    );
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    base = `http://127.0.0.1:${address.port}`;
    return `${base}/index.json`;
  }
  function json(response: http.ServerResponse, value: unknown) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  }

  it("prefers SemVer 2 registrations and loads gzip pages without filtering preview versions", async () => {
    const url = await serve((url, base, response) => {
      if (url === "/index.json")
        return json(response, {
          resources: [
            {
              "@type": "RegistrationsBaseUrl/3.0.0-beta",
              "@id": `${base}/legacy/`,
            },
            {
              "@type": "RegistrationsBaseUrl/3.6.0",
              "@id": `${base}/registration/`,
            },
          ],
        });
      if (url === "/registration/demo/index.json") {
        response.setHeader("Content-Encoding", "gzip");
        response.end(
          gzipSync(
            JSON.stringify({
              count: 2,
              items: [
                {
                  count: 2,
                  items: [
                    {
                      catalogEntry: {
                        ...leaf("1.0.0").catalogEntry,
                        iconUrl: "https://images.test/demo.png",
                      },
                    },
                    leaf("2.0.0-beta.1"),
                  ],
                },
                { count: 1, "@id": `${base}/page` },
              ],
            }),
          ),
        );
        return;
      }
      if (url === "/page")
        return json(response, { count: 1, items: [leaf("3.0.0", false)] });
      response.writeHead(500);
      response.end();
    });
    const catalog = await loadPackageCatalog({
      packageId: "Demo",
      feeds: [feed(url)],
      settings,
      logger,
    });
    expect(catalog.iconUrl).toBe("https://images.test/demo.png");
    expect(catalog.complete).toBe(true);
    expect(catalog.versions.map((v) => [v.version, v.listed])).toEqual([
      ["1.0.0", true],
      ["2.0.0-beta.1", true],
      ["3.0.0", false],
    ]);
    expect(catalog.versions.every((v) => v.feedUrls[0] === url)).toBe(true);
  });

  it("keeps successful pages and sources while reporting incomplete data", async () => {
    const url = await serve((url, base, response) => {
      if (url === "/index.json")
        return json(response, {
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": `${base}/r/` },
          ],
        });
      if (url === "/r/demo/index.json")
        return json(response, {
          count: 2,
          items: [
            { count: 1, items: [leaf("1.0")] },
            { count: 1, "@id": `${base}/broken` },
          ],
        });
      response.writeHead(503);
      response.end();
    });
    const catalog = await loadPackageCatalog({
      packageId: "demo",
      feeds: [feed(url)],
      settings,
      logger,
    });
    expect(catalog.complete).toBe(false);
    expect(catalog.versions.map((v) => v.version)).toEqual(["1.0.0"]);
  });

  it("combines feeds deterministically without using source order as version precedence", async () => {
    const source = async (version: string) =>
      serve((url, base, response) => {
        if (url === "/index.json")
          return json(response, {
            resources: [
              { "@type": "RegistrationsBaseUrl/3.6.0", "@id": `${base}/r/` },
            ],
          });
        json(response, {
          count: 1,
          items: [{ count: 1, items: [leaf(version)] }],
        });
      });
    const a = feed(await source("2.0.0"));
    const b = feed(await source("1.5.0"));
    const forward = await loadPackageCatalog({
      packageId: "Demo",
      feeds: [a, b],
      settings,
      logger,
    });
    expect(
      await loadPackageCatalog({
        packageId: "Demo",
        feeds: [b, a],
        settings,
        logger,
      }),
    ).toEqual(forward);
    expect(forward.versions.map((v) => v.version)).toEqual(["1.5.0", "2.0.0"]);
  });

  it("marks missing leaves, foreign identities and invalid versions as incomplete", async () => {
    const url = await serve((url, base, response) => {
      if (url === "/index.json")
        return json(response, {
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": `${base}/r/` },
          ],
        });
      json(response, {
        count: 1,
        items: [
          {
            count: 4,
            items: [
              leaf("1.0.0"),
              leaf("[1,2)"),
              { catalogEntry: { id: "Other", version: "9.0.0" } },
            ],
          },
        ],
      });
    });
    const catalog = await loadPackageCatalog({
      packageId: "Demo",
      feeds: [feed(url)],
      settings,
      logger,
    });
    expect(catalog.complete).toBe(false);
    expect(catalog.versions.map((v) => v.version)).toEqual(["1.0.0"]);
  });

  it("distinguishes a missing package from a broken registration payload", async () => {
    const url = await serve((url, base, response) => {
      if (url === "/index.json")
        return json(response, {
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": `${base}/r/` },
          ],
        });
      if (url.includes("absent")) {
        response.writeHead(404);
        response.end();
        return;
      }
      json(response, {});
    });
    expect(
      await loadPackageCatalog({
        packageId: "absent",
        feeds: [feed(url)],
        settings,
        logger,
      }),
    ).toMatchObject({ complete: true, versions: [] });
    expect(
      await loadPackageCatalog({
        packageId: "demo",
        feeds: [feed(url)],
        settings,
        logger,
      }),
    ).toMatchObject({ complete: false, versions: [] });
  });

  it("does not treat a failed or disabled source as a complete successful source", async () => {
    const url = await serve((_url, _base, response) => {
      response.writeHead(503);
      response.end();
    });
    expect(
      await loadPackageCatalog({
        packageId: "Demo",
        feeds: [feed(url)],
        settings,
        logger,
      }),
    ).toMatchObject({ complete: false });
    expect(
      await loadPackageCatalog({
        packageId: "Demo",
        feeds: [feed(url, false)],
        settings,
        logger,
      }),
    ).toMatchObject({ complete: true, versions: [] });
  });

  it("cancels instead of caching an aborted load as an empty catalog", async () => {
    const signal = AbortSignal.abort();
    await expect(
      loadPackageCatalog({
        packageId: "Demo",
        feeds: [feed("https://unused.test/index.json")],
        settings,
        logger,
        signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads nuspec identities in flat and hierarchical local feeds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-catalog-"));
    roots.push(root);
    await writeNupkg(
      path.join(root, "Demo.99.0.nupkg"),
      "<package><metadata><id>Demo</id><version>1.5.0</version></metadata></package>",
    );
    await writeNupkg(
      path.join(root, "Demo.Extras.2.0.nupkg"),
      "<package><metadata><id>Demo.Extras</id><version>2.0.0</version></metadata></package>",
    );
    const hierarchical = path.join(root, "demo", "2.0.0-beta");
    await fs.mkdir(hierarchical, { recursive: true });
    await writeNupkg(
      path.join(hierarchical, "demo.2.0.0-beta.nupkg"),
      '<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd"><metadata><id>DEMO</id><version>2.0.0-beta</version></metadata></package>',
    );
    const options = {
      packageId: "Demo",
      feeds: [feed(root)],
      settings,
      logger,
    };
    const catalog = await loadPackageCatalog(options);
    expect(catalog.complete).toBe(true);
    expect(catalog.versions.map((v) => v.version)).toEqual([
      "1.5.0",
      "2.0.0-beta",
    ]);
    await fs.writeFile(path.join(root, "Demo.3.0.nupkg"), "not a zip");
    expect(
      (await loadPackageCatalog({ ...options, force: true })).complete,
    ).toBe(false);
  });

  it("resolves relative local feeds from their declaring config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-relative-"));
    roots.push(root);
    const folder = path.join(root, "feed");
    await fs.mkdir(folder);
    await writeNupkg(
      path.join(folder, "Demo.1.0.nupkg"),
      "<package><metadata><id>Demo</id><version>1.0</version></metadata></package>",
    );
    const source = {
      ...feed("feed"),
      sourceConfigId: path.join(root, "NuGet.Config"),
    };
    expect(
      await loadPackageCatalog({
        packageId: "Demo",
        feeds: [source],
        settings,
        logger,
      }),
    ).toMatchObject({ complete: true, versions: [{ version: "1.0.0" }] });
  });
});
