import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type {
  NuGetConfigFile,
  SourceEdit,
  SourceEditRequest,
} from "#contracts";
import { decodeProjectText, encodeProjectText } from "#client/project-files";
import type { EditorPort } from "./version-edit-io";
import { SourceEditService } from "./source-edit-service";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function fixture(
  options: {
    dirty?: boolean;
    rejectSave?: boolean;
    encoding?: "utf8" | "utf16le" | "utf16be";
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nuget-source-edit-"));
  roots.push(root);
  const file = path.join(root, "NuGet.Config");
  const source = {
    encoding: options.encoding ?? "utf8",
    text: '\ufeff<configuration>\r\n<!-- keep -->\r\n<packageSources><add key="Feed" value="../packages" protocolVersion="3" /></packageSources></configuration>',
  };
  const bytes = encodeProjectText(source);
  await fs.writeFile(file, bytes);
  const editor: EditorPort = {
    open: async (name) => {
      const original = decodeProjectText(await fs.readFile(name));
      let text = original.text.slice(1);
      return {
        version: () => 1,
        text: () => text,
        dirty: () => !!options.dirty,
        edit: async (_, next) => {
          text = next;
          return true;
        },
        save: async () => {
          if (options.rejectSave) return false;
          await fs.writeFile(
            name,
            encodeProjectText(original, "\ufeff" + text),
          );
          return true;
        },
      };
    },
  };
  const service = new SourceEditService(editor);
  const config: NuGetConfigFile = {
    id: file,
    path: file,
    revision: createHash("sha256").update(bytes).digest("hex"),
    name: "NuGet.Config",
    origin: "workspace",
    scope: root,
    hasCredentials: false,
    feeds: [
      {
        id: "feed",
        name: "Feed",
        url: path.resolve(root, "../packages"),
        declaredUrl: "../packages",
        enabled: true,
      },
    ],
  };
  const destinations = await service.describe([config], [root]);
  const destination = destinations.find((item) => item.path === file)!;
  const request: SourceEditRequest & { edit: SourceEdit } = {
    requestId: "edit-1",
    sourceId: file,
    sourceRevision: config.revision!,
    destinationId: destination.id,
    destinationRevision: destination.revision,
    edit: {
      action: "upsert",
      originalName: "Feed",
      name: "Feed",
      url: "../packages",
      enabled: false,
      allowInsecure: false,
    },
  };
  return { root, file, bytes, config, service, request };
}

it.each(["utf8", "utf16le", "utf16be"] as const)(
  "preserves %s BOM, CRLF, relative paths and other source attributes",
  async (encoding) => {
    const test = await fixture({ encoding });
    await test.service.apply(test.request, [test.config]);
    const output = decodeProjectText(await fs.readFile(test.file));
    expect(output.encoding).toBe(encoding);
    expect(output.text).toContain("\ufeff");
    expect(output.text).toContain('value="../packages" protocolVersion="3"');
    expect(output.text).toContain("<!-- keep -->");
    expect(output.text).not.toMatch(/(?<!\r)\n/);
  },
);
it("selects workspace, user and custom destinations from settings", async () => {
  const test = await fixture();
  const select = async (saveIn: string) =>
    (
      await test.service.describe([test.config], [test.root], undefined, saveIn)
    ).find((item) => item.suggested);
  expect((await select("workspace"))?.path).toBe(test.file);
  expect((await select("user"))?.label).toMatch(/^User:/);
  const custom = path.join(test.root, "custom.config");
  expect((await select("custom.config"))?.path).toBe(custom);
  expect((await select(custom))?.path).toBe(custom);
});
it("saves folder properties through the guarded editor", async () => {
  const test = await fixture();
  await test.service.apply(
    {
      ...test.request,
      edit: {
        action: "properties",
        globalPackagesFolder: "cache",
        repositoryPath: "local",
      },
    },
    [test.config],
  );
  const text = decodeProjectText(await fs.readFile(test.file)).text;
  expect(text).toContain('key="globalPackagesFolder" value="cache"');
  expect(text).toContain('key="repositoryPath" value="local"');
  expect(text).toContain('value="../packages"');
  expect(text).toContain("<!-- keep -->");
});
it("rejects stale disk revisions and unadvertised destinations without writing", async () => {
  const test = await fixture();
  await expect(
    test.service.apply(
      { ...test.request, destinationId: path.join(test.root, "other.config") },
      [test.config],
    ),
  ).rejects.toThrow();
  await fs.appendFile(test.file, "<!-- concurrent -->");
  await expect(test.service.apply(test.request, [test.config])).rejects.toThrow(
    "changed",
  );
  expect(await fs.readFile(test.file, "utf8")).toContain("<!-- concurrent -->");
});
it("refuses dirty editor buffers and reports save failure without announcing success", async () => {
  const dirty = await fixture({ dirty: true });
  await expect(
    dirty.service.apply(dirty.request, [dirty.config]),
  ).rejects.toThrow();
  expect(await fs.readFile(dirty.file)).toEqual(dirty.bytes);
  const failed = await fixture({ rejectSave: true });
  await expect(
    failed.service.apply(failed.request, [failed.config]),
  ).rejects.toThrow("saved");
});
it("rejects rename collisions in the source view before writing an override", async () => {
  const test = await fixture();
  test.config.feeds.push({
    id: "other",
    name: "Other",
    url: "https://other.test",
    enabled: true,
  });
  await expect(
    test.service.apply(
      { ...test.request, edit: { ...test.request.edit, name: "Other" } },
      [test.config],
    ),
  ).rejects.toThrow("already exists");
  expect(await fs.readFile(test.file)).toEqual(test.bytes);
});
it("rejects invalidated destinations and encoded credential references", async () => {
  const test = await fixture();
  test.config.credentialNames = ["Feed_x0020_Name"];
  test.config.feeds[0]!.name = "Feed Name";
  await expect(
    test.service.apply(
      {
        ...test.request,
        edit: { ...test.request.edit, originalName: "Feed Name", name: "New" },
      },
      [test.config],
    ),
  ).rejects.toThrow("credentials");
  test.service.invalidate();
  await expect(test.service.apply(test.request, [test.config])).rejects.toThrow(
    "changed",
  );
});

it("creates a missing destination only when an explicit edit is applied", async () => {
  const test = await fixture();
  const folder = path.join(test.root, "project");
  await fs.mkdir(folder);
  const file = path.join(folder, "NuGet.Config");
  const effective = {
    ...test.config,
    id: "effective",
    path: "",
    origin: "effective" as const,
  };
  const destinations = await test.service.describe(
    [effective, test.config],
    [test.root],
    {
      id: "project",
      name: "Project",
      path: path.join(folder, "App.csproj"),
      kind: "project",
      projectPaths: [],
    },
  );
  await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  expect(destinations.find((item) => item.path === file)?.suggested).toBe(true);
  await test.service.apply(
    {
      ...test.request,
      sourceId: "effective",
      destinationId: file,
      destinationRevision: "missing",
      edit: {
        ...test.request.edit,
        originalName: undefined,
        name: "New",
        url: "./packages",
      },
    },
    [effective, test.config],
  );
  expect(await fs.readFile(file, "utf8")).toContain(
    'key="New" value="./packages"',
  );
  expect(await fs.readFile(test.file)).toEqual(test.bytes);
});

it("requires explicit destination choice with multiple roots and no selected target", async () => {
  const test = await fixture();
  const other = path.join(test.root, "other");
  await fs.mkdir(other);
  const destinations = await test.service.describe(
    [test.config],
    [test.root, other],
  );
  expect(destinations.some((item) => item.suggested)).toBe(false);
});

it("stops a save if its context changes during preparation", async () => {
  const test = await fixture();
  let reads = 0;
  await expect(
    test.service.apply(test.request, [test.config], () => ++reads < 2),
  ).rejects.toThrow("context changed");
  expect(await fs.readFile(test.file)).toEqual(test.bytes);
});
