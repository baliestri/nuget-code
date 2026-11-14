import type { FeedInfo, SourcesListResult } from "@nuget-code/protocol";
import { describe, expect, it } from "vitest";
import { buildSummary, EFFECTIVE, feedTarget } from "./summary";

const FEED: FeedInfo = {
  name: "nuget.org",
  source: "https://api.nuget.org/v3/index.json",
  enabled: true,
  allowInsecureConnections: false,
  protocolVersion: 3,
  isLocal: false,
  disableTlsCertificateValidation: false,
  isMachineWide: false,
  declaredIn: "/work/NuGet.config"
};

const SOURCES: SourcesListResult = {
  files: [
    { path: "/work/NuGet.config", feeds: [FEED], writable: true, isMachineWide: false },
    { path: "/home/me/.nuget/NuGet/NuGet.Config", feeds: [], writable: true, isMachineWide: false }
  ],
  effective: [
    FEED,
    { ...FEED, name: "local", source: "/feeds", isLocal: true, enabled: false, declaredIn: undefined as never }
  ],
  fallbackFolders: ["/usr/share/dotnet/NuGetFallbackFolder"],
  globalPackagesFolder: "/home/me/.nuget/packages",
  localPackagesFolder: "/work/packages"
};

describe("buildSummary", () => {
  it("lists the files, the feeds with their attributes and the fallback folders", () => {
    expect(buildSummary(SOURCES)).toBe(
      [
        "### Displaying the effective NuGet.Config, which is a result of combining the following files:",
        "    /work/NuGet.config",
        "    /home/me/.nuget/NuGet/NuGet.Config",
        "",
        "### Feeds",
        "* nuget.org",
        "    Source = https://api.nuget.org/v3/index.json (ProtocolVersion = 3; AllowInsecureConnections = false; DisableTLSCertificateValidation = false)",
        "    IsEnabled = true; IsMachineWide = false; IsLocal = false",
        "    DeclaredIn = /work/NuGet.config",
        "* local",
        "    Source = /feeds (ProtocolVersion = 3; AllowInsecureConnections = false; DisableTLSCertificateValidation = false)",
        "    IsEnabled = false; IsMachineWide = false; IsLocal = true",
        "",
        "### Folders",
        "    GlobalPackagesFolder = /home/me/.nuget/packages",
        "    LocalPackagesFolder = /work/packages",
        "",
        "### FallbackFolders",
        "* /usr/share/dotnet/NuGetFallbackFolder"
      ].join("\n")
    );
  });

  it("has no restore consent section", () => {
    expect(buildSummary(SOURCES)).not.toMatch(/consent/i);
  });
});

describe("feedTarget", () => {
  it("from a file, a change goes to that file", () => {
    expect(feedTarget("/other/NuGet.config", FEED)).toEqual({ file: "/other/NuGet.config" });
    expect(feedTarget("/other/NuGet.config", undefined)).toEqual({ file: "/other/NuGet.config" });
  });

  it("from the effective view, a change goes to the file that declares the feed", () => {
    expect(feedTarget(EFFECTIVE, FEED)).toEqual({ file: "/work/NuGet.config" });
  });

  it("from the effective view, a new feed names no file", () => {
    expect(feedTarget(EFFECTIVE, undefined)).toEqual({});
  });
});
