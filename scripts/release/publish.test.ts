import { expect, it } from "vitest";
import { verifyMarketplaceChecksum } from "./publish.ts";

const version = "2.0.0";
const checksum = "a".repeat(64);

it("confirms a Marketplace publication only when its VSIX checksum matches", () => {
  expect(verifyMarketplaceChecksum([], version, checksum)).toBe(false);
  const versions = [
    {
      version,
      properties: [
        {
          key: "Microsoft.VisualStudio.Services.VsixSha256",
          value: checksum.toUpperCase(),
        },
      ],
    },
  ];
  expect(verifyMarketplaceChecksum(versions, version, checksum)).toBe(true);
  expect(() =>
    verifyMarketplaceChecksum(versions, version, "b".repeat(64)),
  ).toThrow("checksum differs");
  expect(() =>
    verifyMarketplaceChecksum([{ version }], version, checksum),
  ).toThrow("checksum differs");
});
