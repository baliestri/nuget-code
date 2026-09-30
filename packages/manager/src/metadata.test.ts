import { expect, it } from "vitest";
import { packageMetadataUrl } from "./metadata";
it("rejects command, local, credential and token URLs from package metadata", () => {
  for (const url of [
    "command:workbench.action",
    "file:///secret",
    "https://user:pass@example.test",
    "https://example.test/?token=secret",
    "javascript:alert(1)",
    "invalid",
  ])
    expect(packageMetadataUrl(url)).toBeUndefined();
  expect(packageMetadataUrl("https://example.test/project")).toBe(
    "https://example.test/project",
  );
});
