// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   Takes the version the project has of a package to the other projects of the solution that have the
///   package in another version.
/// </summary>
[Cmdlet(VerbsData.Sync, "Package", SupportsShouldProcess = true)]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "AutoPropertyCanBeMadeGetOnly.Global", Justification = Justifications.CMDLET)]
public sealed class SyncPackageCommand : ChangeCmdlet {
  [Parameter(Mandatory = true, Position = 0, ValueFromPipelineByPropertyName = true)]
  public string Id { get; set; } = string.Empty;

  protected override void Run() {
    var projects = Projects();
    var source = RequiredTarget(projects);
    var installed = Wire.OrEmpty(Ask(ConsoleRequestNames.INSTALLED, WireJsonContext.Default.Installed).Projects);

    var package = Find(installed, source.Path) ??
                  throw new ConsoleException($"{Id} is not installed in {source.Name}.");
    var version = VersionOf(package, source).Text;

    var others = projects
      .Where(project => !PathComparer.Equals(project.Path, source.Path))
      .Where(project => Find(installed, project.Path) is { } theirs &&
                        !string.Equals(theirs.ResolvedVersion ?? theirs.RequestedVersion, version,
                          StringComparison.OrdinalIgnoreCase))
      .ToList();
    if (others.Count == 0) {
      Say($"No other project has {package.Id} in a version other than {version}.");
      return;
    }

    IReadOnlyList<Wire.Change> changes = [
      new(UPDATE, package.Id, version, [.. others.Select(project => project.Path)])
    ];
    Apply(
      $"Sync {package.Id} to {version}, the version of {source.Name}",
      string.Join(", ", others.Select(project => project.Name)),
      changes,
      ConsoleRequestNames.UPDATE,
      new Wire.ChangesParams(changes),
      WireJsonContext.Default.ChangesParams
    );
  }

  /// <summary>The reference the project has to the package; null when it has none.</summary>
  private Wire.InstalledPackage? Find(IReadOnlyList<Wire.ProjectPackages> installed, string projectPath)
    => installed
      .Where(project => PathComparer.Equals(project.ProjectPath, projectPath))
      .SelectMany(project => Wire.OrEmpty(project.Packages))
      .FirstOrDefault(candidate
        => !candidate.Implicit && string.Equals(candidate.Id, Id, StringComparison.OrdinalIgnoreCase));
}
