import { expect, it } from "vitest";
import { editPackageSource, editSourceProperties } from "./source-edits";
import { parseXml } from "@rgrove/parse-xml";
it("edits folder overrides without changing credentials, unrelated settings or comments", () => {
  const original =
    '<configuration>\r\n<!-- keep -->\r\n<config><add key="globalPackagesFolder" value="old"/><add key="http_proxy.password" value="secret"/></config><packageSourceCredentials><Private><add key="Password" value="keep"/></Private></packageSourceCredentials></configuration>';
  const updated = editSourceProperties(original, {
    action: "properties",
    globalPackagesFolder: "cache & packages",
    repositoryPath: "local",
  });
  expect(updated).toContain('value="cache &amp; packages"');
  expect(updated).toContain('<add key="http_proxy.password" value="secret"/>');
  expect(updated).toContain(
    '<packageSourceCredentials><Private><add key="Password" value="keep"/></Private></packageSourceCredentials>',
  );
  expect(updated).toContain("<!-- keep -->");
  expect(updated).not.toMatch(/(?<!\r)\n/);
  const removed = editSourceProperties(updated, {
    action: "properties",
    globalPackagesFolder: "",
    repositoryPath: "",
  });
  expect(removed).not.toContain('key="globalPackagesFolder"');
  expect(removed).not.toContain('key="repositoryPath"');
  expect(() => parseXml(removed)).not.toThrow();
});
it("inserts folder properties into empty config and rejects invalid fields", () => {
  expect(
    editSourceProperties("<configuration/>", {
      action: "properties",
      globalPackagesFolder: "cache",
      repositoryPath: "",
    }),
  ).toContain("<config>");
  expect(() =>
    editSourceProperties("<configuration/>", {
      action: "properties",
      globalPackagesFolder: "cache\nother",
      repositoryPath: "",
    }),
  ).toThrow();
});
const edit = {
  action: "upsert" as const,
  originalName: "Feed",
  name: "Feed",
  url: "https://new.test/index.json?a=1&b=2",
  enabled: false,
  allowInsecure: false,
};
it("edits a source while preserving comments, unrelated sections and CRLF", () => {
  const result = editPackageSource(
    '<configuration>\r\n<!-- keep -->\r\n<packageSources><add key="Feed" value="https://old.test" /></packageSources><config><add key="globalPackagesFolder" value="cache" /></config></configuration>',
    edit,
  );
  expect(result).toContain("<!-- keep -->");
  expect(result).toContain('value="https://new.test/index.json?a=1&amp;b=2"');
  expect(result).toContain('<add key="Feed" value="true" />');
  expect(result).toContain(
    '<config><add key="globalPackagesFolder" value="cache" /></config>',
  );
  expect(result).not.toMatch(/(?<!\r)\n/);
});
it("materializes remaining effective feeds for inherited removal without unsupported remove directives", () => {
  const result = editPackageSource(
    "<configuration />",
    { ...edit, action: "remove" },
    [
      { id: "a", name: "Feed", url: "https://old.test", enabled: true },
      { id: "b", name: "Keep", url: "https://keep.test", enabled: true },
    ],
  );
  expect(result).toContain("<clear />");
  expect(result).toContain('key="Keep"');
  expect(result).not.toContain('key="Feed"');
  expect(result).not.toContain("<remove");
});
it("rejects malformed XML, duplicate sources and changes to referenced names", () => {
  expect(() => editPackageSource("<bad", edit)).toThrow();
  expect(() =>
    editPackageSource(
      '<configuration><packageSources><add key="Feed" value="https://old.test" /></packageSources></configuration>',
      { ...edit, originalName: undefined },
    ),
  ).toThrow("already exists");
  expect(() =>
    editPackageSource(
      '<configuration><packageSourceMapping><packageSource key="Feed"><package pattern="*" /></packageSource></packageSourceMapping></configuration>',
      { ...edit, action: "remove" },
    ),
  ).toThrow("mappings");
});

it("preserves attributes and relative paths when changing enabled state", () => {
  const xml =
    '<configuration><packageSources><add key="Feed" value="../packages" protocolVersion="3" disableTLSCertificateValidation="true" /></packageSources></configuration>';
  const result = editPackageSource(xml, { ...edit, url: "../packages" });
  expect(result).toContain('value="../packages"');
  expect(result).toContain('protocolVersion="3"');
  expect(result).toContain('disableTLSCertificateValidation="true"');
});

it("renames an inherited feed without leaving its old identity active", () => {
  const result = editPackageSource(
    "<configuration />",
    { ...edit, name: "Renamed" },
    [
      { id: "a", name: "Feed", url: "https://old.test", enabled: true },
      {
        id: "b",
        name: "Keep",
        url: "https://keep.test",
        enabled: false,
        sourceAttributes: { protocolVersion: "3" },
      },
    ],
  );
  expect(result).toContain("<clear />");
  expect(result).not.toContain('key="Feed"');
  expect(result).toContain('key="Renamed"');
  expect(result).toContain('protocolVersion="3"');
  expect(result).toContain('<add key="Keep" value="true" />');
});

it("does not insert sections into a trailing comment or discard root attributes", () => {
  const result = editPackageSource(
    '<configuration custom="keep" />\n<!-- </configuration> -->',
    edit,
  );
  const root = parseXml(result).root!;
  expect(root.attributes.custom).toBe("keep");
  expect(result).toContain("<!-- </configuration> -->");
  expect(root.children.length).toBeGreaterThan(0);
});

it("rejects conflicting effective identities for every edit and rename collisions", () => {
  const feeds = ["https://one.test", "https://two.test"].map((url) => ({
    id: url,
    name: "Feed",
    url,
    enabled: true,
  }));
  expect(() => editPackageSource("<configuration />", edit, feeds)).toThrow(
    "conflicting",
  );
  expect(() =>
    editPackageSource("<configuration />", { ...edit, name: "Keep" }, [
      feeds[0]!,
      { ...feeds[1]!, name: "Keep" },
    ]),
  ).toThrow("already exists");
});
