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
    var packages = model.Packages.Select(package => Describe(package, resolved?.GetValueOrDefault(package.Id)))
      .ToList();
    return new ProjectPackages(model.Info.Path, packages);
  }

  private static InstalledPackage Describe(DeclaredPackage package, string? resolvedVersion)
    => new(package.Id, package.RequestedVersion, resolvedVersion, package.Frameworks, package.Implicit,
      resolvedVersion is not null);
}
