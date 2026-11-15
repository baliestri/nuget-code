// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Versions;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   Updates one package of the project, or all of them when no id is given: to the newest version, to the
///   one given, or to the newest within the same major or the same major and minor.
/// </summary>
[Cmdlet(VerbsData.Update, "Package", SupportsShouldProcess = true)]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
public sealed class UpdatePackageCommand : ChangeCmdlet {
  /// <summary>The package to update; without it, every package of the project.</summary>
  [Parameter(Position = 0, ValueFromPipelineByPropertyName = true)]
  public string? Id { get; set; }

  /// <summary>The version to go to; it may be older than the one installed.</summary>
  [Parameter(Position = 1)]
  public string? Version { get; set; }

  /// <summary>Lets the version chosen be a prerelease.</summary>
  [Parameter]
  public SwitchParameter IncludePrerelease { get; set; }

  /// <summary>The same as <c>-ToHighestPatch</c>, under the name older consoles gave it.</summary>
  [Parameter]
  public SwitchParameter Safe { get; set; }

  /// <summary>Goes to the newest version with the same major and minor as the one installed.</summary>
  [Parameter]
  public SwitchParameter ToHighestPatch { get; set; }

  /// <summary>Goes to the newest version with the same major as the one installed.</summary>
  [Parameter]
  public SwitchParameter ToHighestMinor { get; set; }

  /// <summary>Changes no version: restores the project again, discarding what was resolved before.</summary>
  [Parameter]
  public SwitchParameter Reinstall { get; set; }

  /// <summary>Does not ask before updating every package of the default project.</summary>
  [Parameter]
  public SwitchParameter Force { get; set; }

  /// <summary>The name of the package source in which the versions are looked up.</summary>
  [Parameter]
  [ArgumentCompleter(typeof(SourceNameCompleter))]
  public string? Source { get; set; }

  protected override void Run() {
    var bound = Bound();
    var project = RequiredTarget(Projects());
    if (Reinstall.IsPresent) {
      if (ShouldProcess(project.Name, "Restore again, discarding what was resolved before")) {
        Operate("Reinstall the packages", ConsoleRequestNames.RESTORE, new Wire.RestoreParams([project.Path], true),
          WireJsonContext.Default.RestoreParams);
      }

      return;
    }

    var referenced = Referenced(project);
    if (string.IsNullOrEmpty(Id)) {
      UpdateAll(project, referenced, bound);
      return;
    }

    var package =
      referenced.FirstOrDefault(candidate => string.Equals(candidate.Id, Id, StringComparison.OrdinalIgnoreCase))
      ?? throw new ConsoleException($"{Id} is not installed in {project.Name}. Use Install-Package.");
    var version = string.IsNullOrEmpty(Version) ? Newest(package, project, bound) : Version;
    if (version is null ||
        string.Equals(version, package.ResolvedVersion ?? package.RequestedVersion,
          StringComparison.OrdinalIgnoreCase)) {
      Say($"{package.Id} is already at {version ?? Reach(bound)} in {project.Name}.");
      return;
    }

    IReadOnlyList<Wire.Change> changes = [new(UPDATE, package.Id, version, [project.Path])];
    Apply($"Update {package.Id} to {version}", project.Name, changes, ConsoleRequestNames.UPDATE,
      new Wire.ChangesParams(changes), WireJsonContext.Default.ChangesParams);
  }

  private void UpdateAll(Wire.SolutionProject project, IReadOnlyList<Wire.InstalledPackage> referenced,
    VersionBound bound) {
    // Every package of a project nobody named is a lot to change by accident: it is asked about first.
    if (string.IsNullOrEmpty(ProjectName) &&
        !Agreed(project)) {
      return;
    }

    var changes = new List<Wire.Change>();
    foreach (var package in referenced) {
      string? version;
      try {
        version = Newest(package, project, bound);
      }
      catch (ConsoleException exception) when (string.Equals(exception.Code, ConsoleException.INVALID_ARGUMENT,
                                                 StringComparison.Ordinal)) {
        // A version that is a range cannot be compared; the other packages are still updated.
        WriteWarning(exception.Message);
        continue;
      }

      if (version is not null) {
        changes.Add(new Wire.Change(UPDATE, package.Id, version, [project.Path]));
      }
    }

    if (changes.Count == 0) {
      Say($"Every package of {project.Name} is already at {Reach(bound)}.");
      return;
    }

    Apply(
      changes.Count == 1 ? $"Update {changes[0].Id} to {changes[0].Version}" : $"Update {changes.Count} packages",
      project.Name,
      changes,
      ConsoleRequestNames.UPDATE,
      new Wire.ChangesParams(changes),
      WireJsonContext.Default.ChangesParams
    );
  }

  /// <summary>How far the update may go. The switches exclude each other and the version given.</summary>
  private VersionBound Bound() {
    var patch = Safe.IsPresent || ToHighestPatch.IsPresent;
    var chosen = (patch ? 1 : 0) + (ToHighestMinor.IsPresent ? 1 : 0) + (string.IsNullOrEmpty(Version) ? 0 : 1) +
                 (Reinstall.IsPresent ? 1 : 0);
    if (chosen > 1) {
      throw new ConsoleException(
        "-Version, -ToHighestMinor, -ToHighestPatch (or -Safe) and -Reinstall exclude each other: give only one.");
    }

    if (!string.IsNullOrEmpty(Version) &&
        string.IsNullOrEmpty(Id)) {
      throw new ConsoleException("-Version needs the id of the package it is the version of.");
    }

    return patch ? VersionBound.Patch : ToHighestMinor.IsPresent ? VersionBound.Minor : VersionBound.None;
  }

  /// <summary>The newest version the package may go to; null when it is already there.</summary>
  private string? Newest(Wire.InstalledPackage package, Wire.SolutionProject project, VersionBound bound)
    => VersionChooser.Choose(VersionsOf(package.Id, Source, IncludePrerelease.IsPresent), VersionOf(package, project),
      bound, IncludePrerelease.IsPresent)?.Text;

  private bool Agreed(Wire.SolutionProject project)
    => Force.IsPresent ||
       IsWhatIf ||
       MyInvocation.BoundParameters.TryGetValue("Confirm", out var confirm) &&
       confirm is SwitchParameter { IsPresent: false } ||
       ShouldContinue($"Update every package of {project.Name}?", "Update-Package");

  private static string Reach(VersionBound bound)
    => bound switch {
      VersionBound.Minor => "the newest version of its major",
      VersionBound.Patch => "the newest patch of its version",
      var _ => "the newest version"
    };
}
