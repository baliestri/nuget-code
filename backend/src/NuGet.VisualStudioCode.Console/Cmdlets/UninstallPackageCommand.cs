// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>Removes a package from the project.</summary>
[Cmdlet(VerbsLifecycle.Uninstall, "Package", SupportsShouldProcess = true)]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "MemberCanBePrivate.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "AutoPropertyCanBeMadeGetOnly.Global", Justification = Justifications.CMDLET)]
public sealed class UninstallPackageCommand : ChangeCmdlet {
  [Parameter(Mandatory = true, Position = 0, ValueFromPipelineByPropertyName = true)]
  public string Id { get; set; } = string.Empty;

  /// <summary>Accepted so that scripts written for other consoles run; it changes nothing here.</summary>
  [Parameter]
  public SwitchParameter Force { get; set; }

  /// <summary>Accepted so that scripts written for other consoles run; it changes nothing here.</summary>
  [Parameter]
  public SwitchParameter RemoveDependencies { get; set; }

  protected override void Run() {
    if (Force.IsPresent ||
        RemoveDependencies.IsPresent) {
      WriteWarning(
        "-Force and -RemoveDependencies do not apply to PackageReference projects: removing a reference never " +
        "fails because of other packages, and what came with it leaves with it. They are ignored.");
    }

    var project = RequiredTarget(Projects());
    Apply(
      $"Uninstall {Id}",
      project.Name,
      [new Wire.Change(REMOVE, Id, null, [project.Path])],
      ConsoleRequestNames.REMOVE,
      new Wire.RemoveParams(Id, [project.Path]),
      WireJsonContext.Default.RemoveParams
    );
  }
}
