import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { packageInstallations } from "./package-installations";
it("only exposes exact valid installed identities beneath known roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-installations-"));
  try {
    const folder = path.join(root, "demo", "1.0.0");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "demo.nuspec"),
      "<package><metadata><id>Demo</id><version>1.0.0</version></metadata></package>",
    );
    expect(
      await packageInstallations("Demo", ["1.0.0", "2.0.0"], [root]),
    ).toEqual([{ version: "1.0.0", path: await fs.realpath(folder) }]);
    expect(await packageInstallations("../demo", ["1.0.0"], [root])).toEqual(
      [],
    );
    await fs.writeFile(
      path.join(folder, "demo.nuspec"),
      "<package><metadata><id>Other</id><version>1.0.0</version></metadata></package>",
    );
    expect(await packageInstallations("Demo", ["1.0.0"], [root])).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("rejects a linked package directory that escapes the known root", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "nuget-installation-link-"),
  );
  try {
    const root = path.join(temporary, "cache");
    const outside = path.join(temporary, "outside");
    await fs.mkdir(path.join(root, "demo"), { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(
      path.join(outside, "demo.nuspec"),
      "<package><metadata><id>Demo</id><version>1.0.0</version></metadata></package>",
    );
    await fs.symlink(outside, path.join(root, "demo", "1.0.0"), "junction");
    expect(await packageInstallations("Demo", ["1.0.0"], [root])).toEqual([]);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
