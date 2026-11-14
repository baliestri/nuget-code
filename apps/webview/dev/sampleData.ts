import type { SessionState } from "@nuget-code/bridge";
import type {
  FeedInfo,
  InstalledPackage,
  OperationResult,
  PackageDetailsResult,
  PackagesInstalledResult,
  PackageSummary,
  ProjectInfo
} from "@nuget-code/protocol";
import type { FakeBridge } from "../test/fakeBridge";

const ROOT = "D:\\work\\sample-library";
const CONFIG = `${ROOT}\\NuGet.Config`;

function project(name: string, error?: string): ProjectInfo {
  return {
    name,
    path: `${ROOT}\\${name}\\${name}.csproj`,
    frameworks: ["net10.0"],
    centralPackageManagement: false,
    ...(error === undefined ? {} : { error })
  };
}

export const PROJECTS: readonly ProjectInfo[] = [
  project("SampleLibrary"),
  project("SampleLibrary.Examples"),
  project("SampleLibrary.Generators"),
  project("SampleLibrary.Generators.Tests"),
  project("SampleLibrary.GpgconfFixture"),
  project("SampleLibrary.Tests")
];

export const SESSION: SessionState = {
  backend: "ready",
  solution: { kind: "open", name: "SampleLibrary.slnx", path: `${ROOT}\\SampleLibrary.slnx`, projects: PROJECTS },
  hasSdk: true
};

function pkg(id: string, version: string, extra: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id,
    requestedVersion: version,
    resolvedVersion: version,
    frameworks: ["net10.0"],
    implicit: false,
    restored: true,
    origin: { kind: "project" },
    ...extra
  };
}

const ANALYZER = pkg("Meziantou.Analyzer", "3.0.326");

const INSTALLED: PackagesInstalledResult = {
  projects: [
    { projectPath: PROJECTS[0]!.path, packages: [ANALYZER] },
    { projectPath: PROJECTS[1]!.path, packages: [ANALYZER] },
    {
      projectPath: PROJECTS[2]!.path,
      packages: [
        ANALYZER,
        pkg("Microsoft.CodeAnalysis.CSharp", "5.9.0"),
        pkg("NETStandard.Library", "2.0.3", { implicit: true })
      ]
    },
    {
      projectPath: PROJECTS[3]!.path,
      packages: [
        ANALYZER,
        pkg("coverlet.collector", "10.1.0"),
        pkg("JetBrains.Annotations", "2026.2.0"),
        pkg("Microsoft.CodeAnalysis.CSharp", "5.9.0"),
        pkg("Microsoft.Extensions.DependencyInjection", "10.0.15"),
        pkg("Microsoft.Extensions.DependencyInjection.Abstractions", "10.0.15"),
        pkg("Microsoft.Extensions.Logging.Abstractions", "10.0.15"),
        pkg("Microsoft.NET.Test.Sdk", "18.12.0"),
        pkg("Moq", "4.21.0", { restored: false, resolvedVersion: undefined as never }),
        pkg("xunit.v3.mtp-v2", "4.0.3")
      ]
    },
    { projectPath: PROJECTS[4]!.path, packages: [ANALYZER] },
    {
      projectPath: PROJECTS[5]!.path,
      packages: [
        ANALYZER,
        pkg("coverlet.collector", "10.1.0"),
        pkg("Microsoft.NET.Test.Sdk", "18.12.0"),
        pkg("xunit.v3.mtp-v2", "4.0.3")
      ]
    }
  ]
};

const LATEST: Record<string, string> = {
  "Meziantou.Analyzer": "3.0.339",
  "Microsoft.Extensions.DependencyInjection": "11.0.0",
  "Microsoft.Extensions.DependencyInjection.Abstractions": "11.0.0",
  "Microsoft.Extensions.Logging.Abstractions": "11.0.0"
};

const AVAILABLE: readonly [id: string, version: string, description: string][] = [
  ["Newtonsoft.Json", "13.0.4", "Json.NET is a popular high-performance JSON framework for .NET"],
  ["Microsoft.Extensions.Primitives", "11.0.0", "Primitives shared by framework extensions."],
  ["Microsoft.Extensions.Options", "11.0.0", "Provides a strongly typed way of specifying and accessing settings."],
  ["Microsoft.Extensions.Configuration.Abstractions", "11.0.0", "Abstractions of key-value pair based configuration."],
  ["Azure.Core", "1.65.0", "Shared primitives, abstractions and helpers for Azure SDK client libraries."],
  ["Serilog", "4.4.0", "Simple .NET logging with fully-structured events."],
  ["Azure.Identity", "1.21.0", "Microsoft Entra ID token authentication for the Azure SDK."],
  ["AWSSDK.Core", "4.1.0", "The Amazon Web Services SDK for .NET, core runtime."],
  ["Polly", "8.9.1", "Resilience and transient-fault-handling library."],
  ["Swashbuckle.AspNetCore.SwaggerGen", "11.0.1", "Swagger generator for APIs built on ASP.NET Core."],
  ["Google.Protobuf", "3.36.2", "C# runtime library for Protocol Buffers."],
  ["Newtonsoft.Json.Bson", "1.0.3", "Json.NET BSON adds support for reading and writing BSON."]
];

const FEEDS: readonly FeedInfo[] = [
  {
    name: "nuget.org",
    source: "https://api.nuget.org/v3/index.json",
    enabled: true,
    allowInsecureConnections: false,
    protocolVersion: 3,
    isLocal: false,
    disableTlsCertificateValidation: false,
    isMachineWide: false,
    declaredIn: CONFIG
  }
];

function details(id: string): PackageDetailsResult {
  const known = AVAILABLE.find(([name]) => name.toLowerCase() === id.toLowerCase());
  const newest = LATEST[id] ?? known?.[1];
  const current = INSTALLED.projects.flatMap((item) => item.packages).find((item) => item.id === id)?.requestedVersion;
  const versions = [...new Set([newest, current, "1.0.0"].filter((item): item is string => item !== undefined))];
  return {
    id,
    versions,
    description: known?.[2] ?? `${id} is one of the packages of the sample solution.`,
    authors: "Sample Authors",
    license: "MIT",
    licenseUrl: "https://licenses.nuget.org/MIT",
    projectUrl: `https://www.nuget.org/packages/${id}`,
    dependencyGroups: [
      { framework: "net10.0", dependencies: [] },
      { framework: "netstandard2.0", dependencies: [{ id: "System.Memory", range: "[4.6.0, )" }] }
    ],
    feed: "nuget.org",
    failures: []
  };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Gives the fake bridge answers that look like a real solution. Each tab adds what it needs here. */
export function installSampleData(fake: FakeBridge): void {
  const operation = async (projects: readonly string[]): Promise<OperationResult> => {
    for (const step of ["planning", "editing", "evaluating", "restoring", "done"] as const) {
      fake.emit("operationProgress", { step });
      await wait(400);
    }

    return {
      engine: "embedded",
      fellBack: false,
      projects: projects.map((path) => ({
        project: path,
        changedFiles: [path],
        editErrors: [],
        restore: "succeeded",
        messages: []
      }))
    };
  };

  fake.backend.installedPackages = () => Promise.resolve(INSTALLED);
  fake.backend.packageUpdates = () =>
    Promise.resolve({
      packages: [...new Set(INSTALLED.projects.flatMap((item) => item.packages.map((entry) => entry.id)))].map(
        (id) => ({
          id,
          versions: LATEST[id] === undefined ? [] : [{ feed: "nuget.org", version: LATEST[id] }]
        })
      ),
      failures: []
    });
  fake.backend.searchPackages = (params) =>
    Promise.resolve({
      packages: AVAILABLE.filter(([id]) => id.toLowerCase().includes((params.query ?? "").toLowerCase())).map(
        ([id, version, description]): PackageSummary => ({
          id,
          version,
          description,
          authors: "Sample Authors",
          feed: "nuget.org"
        })
      ),
      failures: []
    });
  fake.backend.packageDetails = (params) => Promise.resolve(details(params.id));
  fake.backend.planPackages = () => Promise.resolve({ edits: [], warnings: [] });
  fake.backend.updatePackages = (params) => operation(params.changes.flatMap((change) => change.projects));
  fake.backend.installPackage = (params) => operation(params.projects);
  fake.backend.removePackage = (params) => operation(params.projects);
  fake.backend.restore = () => operation(PROJECTS.map((item) => item.path));
  fake.backend.cancelOperation = () => Promise.resolve({});
  fake.backend.listSources = () =>
    Promise.resolve({
      files: [{ path: CONFIG, feeds: FEEDS, writable: true, isMachineWide: false }],
      effective: FEEDS,
      fallbackFolders: [],
      globalPackagesFolder: "C:\\Users\\sample\\.nuget\\packages"
    });
  fake.host.pickFolder = () => Promise.resolve({ path: `${ROOT}\\packages` });
}
