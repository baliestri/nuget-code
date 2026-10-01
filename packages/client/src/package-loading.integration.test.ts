import http from "node:http";
import { expect, it } from "vitest";
import { ClientNetwork } from "./client-network";
import { loadPackageCatalog } from "./package-catalog";

it("loads 200 packages across three sources with three indexes and at most six HTTP attempts", async () => {
  const network = new ClientNetwork();
  let indexes = 0;
  let requests = 0;
  let active = 0;
  let peak = 0;
  const server = http.createServer((request, response) => {
    requests++;
    peak = Math.max(peak, ++active);
    const parts = request.url!.split("/").filter(Boolean);
    const source = parts[0];
    let body: unknown;
    if (parts.length === 2) {
      indexes++;
      body = {
        resources: [
          {
            "@type": "RegistrationsBaseUrl/3.6.0",
            "@id": `${base}/${source}/registration/`,
          },
        ],
      };
    } else {
      const id = parts[2]!;
      body = {
        count: 1,
        items: [
          {
            items: ["1.0.0", "1.5.0"].map((version) => ({
              catalogEntry: { id, version, listed: true },
            })),
          },
        ],
      };
    }
    setImmediate(() => {
      active--;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const settings = {
    network,
    dotnetPath: "dotnet",
    nugetPath: "nuget",
    credentialProviderPaths: [],
    extraConfigPaths: [],
    proxy: "",
    maxSearchResults: 100,
  };
  const logger = {
    verbose: () => {},
    information: () => {},
    warning: () => {},
    error: () => {},
  };
  const feeds = [0, 1, 2].map((id) => ({
    id: String(id),
    name: String(id),
    url: `${base}/${id}/index.json`,
    enabled: true,
  }));
  try {
    const load = (i: number) =>
      loadPackageCatalog({
        packageId: `Demo.Package-${i}`,
        feeds,
        settings,
        logger,
      });
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => Promise.all([load(i), load(i)])),
    );
    expect(
      results.every(
        ([a, b]) => a.complete && b.complete && a.versions.length === 2,
      ),
    ).toBe(true);
    expect(indexes).toBe(3);
    expect(peak).toBeLessThanOrEqual(6);
    expect(network.requests.metrics().peak).toBeLessThanOrEqual(6);
    expect(requests).toBe(603);
    const count = requests;
    await Promise.all(Array.from({ length: 200 }, (_, i) => load(i)));
    expect(requests).toBe(count);
    console.info(
      JSON.stringify({
        packages: 200,
        sources: 3,
        serviceIndexRequests: indexes,
        requests,
        serverPeak: peak,
        ...network.requests.metrics(),
        cache: network.facts.metrics(),
      }),
    );
  } finally {
    network.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
