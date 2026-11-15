import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A NuGet V3 feed over HTTP that answers the service index and search, behind Basic authentication. */
export class PrivateFeed {
  readonly requests: string[] = [];

  private constructor(
    private readonly server: Server,
    readonly url: string
  ) {}

  static async start(packageId: string, version: string, user: string, password: string): Promise<PrivateFeed> {
    const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    let feed: PrivateFeed | undefined;
    const server = createServer((request, response) => {
      const path = (request.url ?? "").split("?")[0] ?? "";
      feed?.requests.push(path);
      if (request.headers.authorization !== expected) {
        response.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' }).end();
        return;
      }

      const base = feed?.url ?? "";
      const body =
        path === "/v3/index.json" ? serviceIndex(base) : path === "/v3/query" ? search(base, packageId, version) : null;
      if (body === null) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    feed = new PrivateFeed(server, `http://localhost:${port}`);
    return feed;
  }

  get indexUrl(): string {
    return `${this.url}/v3/index.json`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function serviceIndex(base: string): object {
  const query = `${base}/v3/query`;
  return {
    version: "3.0.0",
    resources: [
      { "@id": query, "@type": "SearchQueryService" },
      { "@id": query, "@type": "SearchQueryService/3.0.0-beta" },
      { "@id": query, "@type": "SearchQueryService/3.0.0-rc" },
      { "@id": query, "@type": "SearchQueryService/3.5.0" },
      { "@id": query, "@type": "SearchQueryService/Versioned", clientVersion: "4.0.0" },
      { "@id": `${base}/v3/reg/`, "@type": "RegistrationsBaseUrl" },
      { "@id": `${base}/v3/flat/`, "@type": "PackageBaseAddress/3.0.0" }
    ]
  };
}

function search(base: string, id: string, version: string): object {
  return {
    totalHits: 1,
    data: [
      {
        id,
        version,
        description: `${id} from the private feed.`,
        authors: ["tests"],
        totalDownloads: 42,
        versions: [{ version, downloads: 42, "@id": `${base}/v3/reg/${id.toLowerCase()}/${version}.json` }]
      }
    ]
  };
}
