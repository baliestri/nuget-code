import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { LocalFeedIndex } from "./local-feed-index";
import { writeNupkg } from "./test/nupkg-fixture";
it("indexes flat/hierarchical identities once and revalidates on force without splitting filenames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-index-"));
  const index = new LocalFeedIndex();
  const spec = (id: string, version: string) =>
    `<package><metadata><id>${id}</id><version>${version}</version></metadata></package>`;
  try {
    await writeNupkg(
      path.join(root, "arbitrary.nupkg"),
      spec("Company.Tools.Core", "1.2.3"),
    );
    await fs.mkdir(path.join(root, "other", "2.0.0"), { recursive: true });
    await writeNupkg(
      path.join(root, "other", "2.0.0", "other.nupkg"),
      spec("Other-with-hyphens", "2.0.0"),
    );
    const [a, b] = await Promise.all([
      index.read(root, false),
      index.read(root, false),
    ]);
    expect(a).toEqual(b);
    expect(a.map((entry) => entry.packageId).sort()).toEqual([
      "Company.Tools.Core",
      "Other-with-hyphens",
    ]);
    expect(index.metrics().scans).toBe(1);
    await writeNupkg(
      path.join(root, "new.nupkg"),
      spec("Company.Tools.Core", "1.5.0"),
    );
    expect(await index.read(root, false)).toHaveLength(2);
    expect(await index.read(root, true)).toHaveLength(3);
    expect(index.metrics().scans).toBe(2);
  } finally {
    index.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("reports a missing directory once per source generation instead of once per package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-missing-feed-"));
  const index = new LocalFeedIndex();
  const report = vi.fn();
  try {
    const folder = path.join(root, "missing");
    await Promise.all(
      Array.from({ length: 20 }, () =>
        index.snapshot(folder, 1, undefined, report),
      ),
    );
    expect(report).toHaveBeenCalledOnce();
    expect(index.metrics().scans).toBe(1);
    await index.snapshot(folder, 1, undefined, report);
    expect(report).toHaveBeenCalledOnce();
    await index.snapshot(folder, 2, undefined, report);
    expect(report).toHaveBeenCalledTimes(2);
  } finally {
    index.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
