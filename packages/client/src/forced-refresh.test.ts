import http from "node:http";
import { expect, it } from "vitest";
import { ClientNetwork } from "./client-network";
import { loadPackageCatalog } from "./package-catalog";
it("does not join an old catalog response when refresh starts a new generation", async () => {
  const network = new ClientNetwork();
  let versions = ["1.0.0"];
  let first!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let registrations = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/index.json") {
      response.end(
        JSON.stringify({
          resources: [
            {
              "@type": "RegistrationsBaseUrl/3.6.0",
              "@id": `${base}/registration/`,
            },
          ],
        }),
      );
      return;
    }
    const body = JSON.stringify({
      items: [
        {
          items: versions.map((version) => ({
            catalogEntry: { id: "Demo", version, listed: true },
          })),
        },
      ],
    });
    if (++registrations === 1) {
      first = () => response.end(body);
      arrived();
    } else response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const options = {
    packageId: "Demo",
    feeds: [
      { id: "feed", name: "Feed", url: `${base}/index.json`, enabled: true },
    ],
    settings: {
      network,
      dotnetPath: "dotnet",
      nugetPath: "nuget",
      proxy: "",
      maxSearchResults: 100,
      credentialProviderPaths: [],
      extraConfigPaths: [],
    },
    logger: {
      verbose: () => {},
      information: () => {},
      warning: () => {},
      error: () => {},
    },
  };
  try {
    const old = loadPackageCatalog(options);
    await gate;
    versions = ["1.0.0", "1.5.0"];
    const fresh = await loadPackageCatalog({ ...options, force: true });
    expect(fresh.versions.at(-1)?.version).toBe("1.5.0");
    first();
    expect((await old).versions).toHaveLength(1);
    expect((await loadPackageCatalog(options)).revision).toBe(fresh.revision);
  } finally {
    first?.();
    network.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
