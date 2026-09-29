import { describe, expect, it } from "vitest";
import type { PackageCatalog } from "#contracts";
import { mergeCatalogs } from "./package-catalog";

function catalog(overrides: Partial<PackageCatalog> = {}): PackageCatalog {
  return {
    packageId: "Demo",
    revision: "a",
    complete: true,
    versions: [
      { version: "1.0", feedUrls: ["https://a/index.json"], listed: true },
    ],
    ...overrides,
  };
}

describe("catalog composition", () => {
  it("merges equivalent versions and package IDs independently of input order", () => {
    const a = catalog();
    const b = catalog({
      packageId: "demo",
      revision: "b",
      versions: [
        {
          version: "1.0.0+build",
          feedUrls: ["https://b/index.json"],
          listed: true,
        },
        {
          version: "2.0.0-beta",
          feedUrls: ["https://b/index.json"],
          listed: true,
        },
      ],
    });
    const result = mergeCatalogs([a, b]);
    expect(result).toEqual(mergeCatalogs([b, a]));
    expect(result).toEqual([
      expect.objectContaining({
        packageId: "demo",
        complete: true,
        versions: [
          {
            version: "1.0.0",
            feedUrls: ["https://a/index.json", "https://b/index.json"],
            listed: true,
          },
          {
            version: "2.0.0-beta",
            feedUrls: ["https://b/index.json"],
            listed: true,
          },
        ],
      }),
    ]);
  });

  it("does not mark an unlisted version as listed on a different feed", () => {
    const hidden = catalog({
      revision: "hidden",
      versions: [
        {
          version: "1.0.0",
          feedUrls: ["https://hidden/index.json"],
          listed: false,
        },
      ],
    });
    const [result] = mergeCatalogs([catalog(), hidden]);
    expect(result?.versions).toHaveLength(2);
    expect(
      result?.versions.filter((v) => v.listed).flatMap((v) => v.feedUrls),
    ).toEqual(["https://a/index.json"]);
    expect(mergeCatalogs([hidden, catalog()])).toEqual([result]);
  });

  it("preserves feed path case while normalizing HTTP origin spelling", () => {
    const [result] = mergeCatalogs([
      catalog({
        versions: [
          {
            version: "1",
            feedUrls: [
              "HTTPS://FEED.test:443/Packages/index.json",
              "https://feed.test/Packages/index.json",
              "https://feed.test/packages/index.json",
            ],
            listed: true,
          },
        ],
      }),
    ]);
    expect(result?.versions[0]?.feedUrls).toEqual([
      "https://feed.test/Packages/index.json",
      "https://feed.test/packages/index.json",
    ]);
  });

  it("preserves local feed paths without assuming Windows case rules", () => {
    const [result] = mergeCatalogs([
      catalog({
        versions: [
          {
            version: "1",
            feedUrls: ["/Feed", "/feed", "C:\\Feed"],
            listed: true,
          },
        ],
      }),
    ]);
    expect(result?.versions[0]?.feedUrls).toEqual([
      "/Feed",
      "/feed",
      "C:\\Feed",
    ]);
  });

  it("keeps successful versions but reports an incomplete contributing feed", () => {
    const [result] = mergeCatalogs([
      catalog(),
      catalog({ revision: "failed", complete: false, versions: [] }),
    ]);
    expect(result?.complete).toBe(false);
    expect(result?.versions).toHaveLength(1);
  });

  it("does not represent invalid source data as a complete valid catalog", () => {
    const [result] = mergeCatalogs([
      catalog({
        versions: [
          {
            version: "[1,2)",
            feedUrls: ["https://a/index.json"],
            listed: true,
          },
          {
            version: "1.5.0",
            feedUrls: ["https://a/index.json"],
            listed: true,
          },
        ],
      }),
    ]);
    expect(result?.complete).toBe(false);
    expect(result?.versions.map((v) => v.version)).toEqual(["1.5.0"]);
  });

  it("deduplicates case-insensitive labels and signed legacy equivalents", () => {
    const [result] = mergeCatalogs([
      catalog({
        versions: [
          {
            version: "1.0-ALPHA",
            feedUrls: ["https://a/index.json"],
            listed: true,
          },
          {
            version: "1.0.0-alpha",
            feedUrls: ["https://b/index.json"],
            listed: true,
          },
          {
            version: "1.0.0--01",
            feedUrls: ["https://a/index.json"],
            listed: true,
          },
          {
            version: "1.0.0--1",
            feedUrls: ["https://b/index.json"],
            listed: true,
          },
        ],
      }),
    ]);
    expect(result?.versions).toHaveLength(2);
    expect(result?.versions.every((v) => v.feedUrls.length === 2)).toBe(true);
  });

  it("sorts packages and versions deterministically without mutating inputs", () => {
    const values = [
      catalog({
        packageId: "Zoo",
        versions: [
          {
            version: "2.0",
            feedUrls: ["https://b/index.json", "https://a/index.json"],
            listed: true,
          },
          { version: "1.0", feedUrls: ["https://a/index.json"], listed: true },
        ],
      }),
      catalog({ packageId: "Alpha" }),
    ];
    const before = structuredClone(values);
    const result = mergeCatalogs(values);
    expect(result.map((c) => c.packageId)).toEqual(["alpha", "zoo"]);
    expect(result[1]?.versions.map((v) => v.version)).toEqual([
      "1.0.0",
      "2.0.0",
    ]);
    expect(values).toEqual(before);
  });

  it("includes source revisions, content and completeness in the merged revision", () => {
    const revision = mergeCatalogs([catalog()])[0]?.revision;
    expect(mergeCatalogs([catalog({ revision: "b" })])[0]?.revision).not.toBe(
      revision,
    );
    expect(mergeCatalogs([catalog({ complete: false })])[0]?.revision).not.toBe(
      revision,
    );
    expect(mergeCatalogs([catalog({ versions: [] })])[0]?.revision).not.toBe(
      revision,
    );
    expect(mergeCatalogs([catalog(), catalog()])[0]?.revision).toBe(revision);
  });

  it("preserves explicit empty catalogs and accepts empty input", () => {
    expect(mergeCatalogs([])).toEqual([]);
    expect(mergeCatalogs([catalog({ versions: [] })])[0]).toMatchObject({
      complete: true,
      versions: [],
    });
  });
});
