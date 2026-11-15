// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class PackagesMethods {
  public static void Register(RpcConnection connection, SessionManager sessions, PackageSearchService search,
    PackageDetailsService details, PackageUpdatesService updates, VulnerabilityService vulnerabilities) {
    connection.OnRequest(MethodNames.PACKAGES_VULNERABILITIES,
      ProtocolJsonContext.Default.PackagesVulnerabilitiesParams,
      ProtocolJsonContext.Default.PackagesVulnerabilitiesResult,
      (parameters, ct) => vulnerabilities.CheckAsync(Resolved(sessions), parameters.NoCache, ct));
    connection.OnRequest(MethodNames.PACKAGES_UPDATES, ProtocolJsonContext.Default.PackagesUpdatesParams,
      ProtocolJsonContext.Default.PackagesUpdatesResult,
      (parameters, ct) => UpdatesAsync(connection, sessions, updates, parameters, ct));
    connection.OnRequest(MethodNames.PACKAGES_INSTALLED, ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.PackagesInstalledResult,
      (_, _) => Task.FromResult(new PackagesInstalledResult(sessions.Require().Projects.Select(Describe).ToList())));
    connection.OnRequest(MethodNames.PACKAGES_SEARCH, ProtocolJsonContext.Default.PackagesSearchParams,
      ProtocolJsonContext.Default.PackagesSearchResult, search.SearchAsync);
    connection.OnRequest(MethodNames.PACKAGES_DETAILS, ProtocolJsonContext.Default.PackagesDetailsParams,
      ProtocolJsonContext.Default.PackageDetailsResult, details.GetAsync);
  }

  private static async Task<PackagesUpdatesResult> UpdatesAsync(RpcConnection connection, SessionManager sessions,
    PackageUpdatesService updates, PackagesUpdatesParams parameters, CancellationToken ct) {
    var projects = sessions.Require().Projects;
    var ids = (parameters.Transitive
        ? projects.SelectMany(model => Assets(model)?.Transitive ?? []).Select(package => package.Id)
        : projects.SelectMany(model => model.Packages).Where(package => !package.Implicit)
          .Select(package => package.Id))
      .Distinct(StringComparer.OrdinalIgnoreCase)
      .ToList();
    await ProgressAsync(connection, parameters.ProgressToken, ProgressKinds.BEGIN, null).ConfigureAwait(false);
    try {
      return await updates
        .GetAsync(ids, parameters,
          package => ProgressAsync(connection, parameters.ProgressToken, ProgressKinds.REPORT, package),
          ct)
        .ConfigureAwait(false);
    }
    finally {
      await ProgressAsync(connection, parameters.ProgressToken, ProgressKinds.END, null).ConfigureAwait(false);
    }
  }

  private static Task ProgressAsync(RpcConnection connection, string? token, string kind, PackageLatest? package)
    => token is null
      ? Task.CompletedTask
      : connection.NotifyAsync(MethodNames.PROGRESS, new ProgressParams(token, kind, package),
        ProtocolJsonContext.Default.ProgressParams);

  private static ProjectPackages Describe(EvaluatedProject model) {
    var assets = Assets(model);
    var locator = new VersionOriginLocator();
    var packages = model.Packages
      .Select(package => Describe(model.Info, package, assets?.Resolved.GetValueOrDefault(package.Id), locator))
      .ToList();
    return new ProjectPackages(model.Info.Path, packages, assets?.Transitive ?? []);
  }

  /// <summary>Every package version the last restore resolved, referenced or transitive, in any project.</summary>
  private static List<(string Id, string Version)> Resolved(SessionManager sessions)
    => sessions.Require().Projects
      .SelectMany(model => Assets(model)?.Resolved ?? new Dictionary<string, string>(StringComparer.Ordinal))
      .Select(package => (package.Key, package.Value))
      .ToList();

  private static ResolvedAssets? Assets(EvaluatedProject model)
    => AssetsReader.Read(model.AssetsPath, model.Packages.Select(package => package.Id).ToList());

  private static InstalledPackage Describe(ProjectInfo project, DeclaredPackage package, string? resolvedVersion,
    VersionOriginLocator locator) {
    var origin = package.Implicit
      ? null
      : locator.Locate(project.Path, package.Id, project.CentralPackageManagement, package.HasVersionOverride);
    return new InstalledPackage(package.Id, package.RequestedVersion, resolvedVersion, package.Frameworks,
      package.Implicit, resolvedVersion is not null, origin);
  }
}
