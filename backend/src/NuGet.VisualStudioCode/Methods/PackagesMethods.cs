// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Methods;

internal static class PackagesMethods {
  public static void Register(RpcConnection connection, SessionManager sessions)
    => connection.OnRequest(
      MethodNames.PACKAGES_INSTALLED,
      ProtocolJsonContext.Default.Empty,
      ProtocolJsonContext.Default.PackagesInstalledResult,
      (_, _) => Task.FromResult(new PackagesInstalledResult(sessions.Require().Projects.Select(Describe).ToList()))
    );

  private static ProjectPackages Describe(EvaluatedProject model) {
    var resolved = AssetsReader.ReadResolved(model.AssetsPath);
    var locator = new VersionOriginLocator();
    var packages = model.Packages
      .Select(package => Describe(model.Info, package, resolved?.GetValueOrDefault(package.Id), locator))
      .ToList();
    return new ProjectPackages(model.Info.Path, packages);
  }

  private static InstalledPackage Describe(ProjectInfo project, DeclaredPackage package, string? resolvedVersion,
    VersionOriginLocator locator) {
    var origin = package.Implicit
      ? null
      : locator.Locate(project.Path, package.Id, project.CentralPackageManagement, package.HasVersionOverride);
    return new InstalledPackage(package.Id, package.RequestedVersion, resolvedVersion, package.Frameworks,
      package.Implicit, resolvedVersion is not null, origin);
  }
}
