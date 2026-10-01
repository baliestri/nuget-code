import { expect, it, vi } from "vitest";
import { openVsxHasVersion, openVsxPublishedChecksum } from "./openvsx.ts";

it("distinguishes an unpublished version from a registry failure", async () => {
  const missing = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 404 }));
  await expect(openVsxHasVersion("2.0.0", missing)).resolves.toBe(false);
  expect(missing).toHaveBeenCalledWith(
    "https://open-vsx.org/api/baliestri/nuget-code/universal/2.0.0",
    expect.objectContaining({ headers: { Accept: "application/json" } }),
  );

  const failed = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 503 }));
  await expect(openVsxHasVersion("2.0.0", failed)).rejects.toThrow("503");
});

it("requires the exact extension identity from Open VSX", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      namespace: "baliestri",
      name: "nuget-code",
      version: "2.0.0",
    }),
  );
  await expect(openVsxHasVersion("2.0.0", request)).resolves.toBe(true);
  request.mockResolvedValueOnce(
    Response.json({
      namespace: "someone-else",
      name: "nuget-code",
      version: "2.0.0",
    }),
  );
  await expect(openVsxHasVersion("2.0.0", request)).rejects.toThrow("identity");
});

it("reads the checksum only from the matching Open VSX artifact", async () => {
  const checksumUrl =
    "https://open-vsx.org/api/baliestri/nuget-code/2.0.0/file/baliestri.nuget-code-2.0.0.sha256";
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        namespace: "baliestri",
        name: "nuget-code",
        version: "2.0.0",
        files: { sha256: checksumUrl },
      }),
    )
    .mockResolvedValueOnce(new Response(`${"a".repeat(64)}\n`));
  await expect(openVsxPublishedChecksum("2.0.0", request)).resolves.toBe(
    "a".repeat(64),
  );
  expect(request).toHaveBeenLastCalledWith(checksumUrl);

  request.mockResolvedValueOnce(
    Response.json({
      namespace: "baliestri",
      name: "nuget-code",
      version: "2.0.0",
      files: { sha256: "https://example.com/other.sha256" },
    }),
  );
  await expect(openVsxPublishedChecksum("2.0.0", request)).rejects.toThrow(
    "checksum URL",
  );
});
