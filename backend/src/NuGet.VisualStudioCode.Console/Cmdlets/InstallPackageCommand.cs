// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Installs a package in the project: the version given, or the newest the sources have.</summary>
[Cmdlet(VerbsLifecycle.Install, "Package", SupportsShouldProcess = true)]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "AutoPropertyCanBeMadeGetOnly.Global", Justification = Justifications.CMDLET)]
public sealed class InstallPackageCommand : ChangeCmdlet {
  [Parameter(Mandatory = true, Position = 0, ValueFromPipelineByPropertyName = true)]
  public string Id { get; set; } = string.Empty;

  /// <summary>The version to install; without it, the newest.</summary>
  [Parameter(Position = 1)]
  public string? Version { get; set; }

  /// <summary>Lets the newest version be a prerelease.</summary>
  [Parameter]
  public SwitchParameter IncludePrerelease { get; set; }

  /// <summary>The name of the package source in which the newest version is looked up.</summary>
  [Parameter]
  [ArgumentCompleter(typeof(SourceNameCompleter))]
  public string? Source { get; set; }

  protected override void Run() {
    var project = RequiredTarget(Projects());
    var version = Version;
    if (string.IsNullOrEmpty(version)) {
      version = VersionsOf(Id, Source, IncludePrerelease.IsPresent).FirstOrDefault() ??
                throw new ConsoleException(
                  $"No package source has {Id}{(IncludePrerelease.IsPresent ? string.Empty : " in a stable version; try -IncludePrerelease")}.");
    }

    Apply(
      $"Install {Id} {version}",
      project.Name,
      [new Wire.Change(INSTALL, Id, version, [project.Path])],
      ConsoleRequestNames.INSTALL,
      new Wire.InstallParams(Id, version, [project.Path]),
      WireJsonContext.Default.InstallParams
    );
  }
}
