// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using System.Diagnostics.CodeAnalysis;
using System.Management.Automation;
using NuGet.VisualStudioCode.Console.Channel;
using NuGet.VisualStudioCode.Console.Model;
using NuGet.VisualStudioCode.Console.Versions;

namespace NuGet.VisualStudioCode.Console.Cmdlets;

/// <summary>
///   Returns the packages of a project: the one named, else the default one, else every project of the
///   solution. The switches narrow them to the ones with a newer version or with known vulnerabilities.
/// </summary>
[Cmdlet(VerbsCommon.Get, "Package")]
[OutputType(typeof(ConsolePackage))]
[SuppressMessage("ReSharper", "UnusedType.Global", Justification = Justifications.CMDLET)]
[SuppressMessage("ReSharper", "UnusedAutoPropertyAccessor.Global", Justification = Justifications.CMDLET)]
public sealed class GetPackageCommand : ProjectCmdlet {
  /// <summary>Only the packages whose id contains this text.</summary>
  [Parameter(Position = 0)]
  public string? Filter { get; set; }

  /// <summary>Only the packages with a newer version on the feeds, with that version.</summary>
  [Parameter]
  public SwitchParameter Updates { get; set; }

  /// <summary>Counts prerelease versions as updates.</summary>
  [Parameter]
  public SwitchParameter IncludePrerelease { get; set; }

  /// <summary>Also the packages the project has without referencing them.</summary>
  [Parameter]
  public SwitchParameter Transitive { get; set; }

  /// <summary>Only the packages with known vulnerabilities, transitive ones included, with their advisories.</summary>
  [Parameter]
  public SwitchParameter Vulnerable { get; set; }

  protected override void Run() {
    var projects = Projects();
    var target = Target(projects);
    var names = projects.ToDictionary(project => project.Path, project => project.Name, PathComparer);
    var installed = Wire.OrEmpty(Ask(ConsoleRequestNames.INSTALLED, WireJsonContext.Default.Installed).Projects)
      .Where(project => target is null || PathComparer.Equals(project.ProjectPath, target.Path))
      .ToList();

    var packages = new List<ConsolePackage>();
    foreach (var project in installed) {
      var name = names.GetValueOrDefault(project.ProjectPath) ?? Path.GetFileNameWithoutExtension(project.ProjectPath);
      packages.AddRange(Wire.OrEmpty(project.Packages)
        // A package the SDK adds on its own cannot be changed, and is not listed.
        .Where(package => !package.Implicit)
        .Select(package => new ConsolePackage(package.Id, package.ResolvedVersion ?? package.RequestedVersion, name)));
      if (Transitive.IsPresent ||
          Vulnerable.IsPresent) {
        packages.AddRange(Wire.OrEmpty(project.Transitive).Select(package
          => new ConsolePackage(package.Id, package.ResolvedVersion, name) {
            IsTransitive = true, Via = Wire.OrEmpty(package.Via)
          }));
      }
    }

    if (!string.IsNullOrEmpty(Filter)) {
      packages = packages.Where(package => package.Id.Contains(Filter, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    if (Updates.IsPresent) {
      packages = WithUpdates(packages);
    }

    if (Vulnerable.IsPresent) {
      packages = WithAdvisories(packages);
    }

    foreach (var package in packages
               .OrderBy(package => package.ProjectName, StringComparer.OrdinalIgnoreCase)
               .ThenBy(package => package.IsTransitive)
               .ThenBy(package => package.Id, StringComparer.OrdinalIgnoreCase))
      WriteObject(package);
  }

  private List<ConsolePackage> WithUpdates(List<ConsolePackage> packages) {
    var latest = new Dictionary<string, PackageVersion>(StringComparer.OrdinalIgnoreCase);
    Gather(false);
    if (packages.Exists(package => package.IsTransitive)) {
      Gather(true);
    }

    return packages
      .Where(package => latest.TryGetValue(package.Id, out var newest) &&
                        PackageVersion.TryParse(package.Version, out var current) &&
                        newest.IsNewerThan(current))
      .Select(package => new ConsolePackage(package.Id, package.Version, package.ProjectName) {
        LatestVersion = latest[package.Id].Text, IsTransitive = package.IsTransitive, Via = package.Via
      })
      .ToList();

    void Gather(bool transitive) {
      var updates = Ask(
        ConsoleRequestNames.UPDATES,
        new Wire.UpdatesParams(IncludePrerelease.IsPresent, transitive),
        WireJsonContext.Default.UpdatesParams,
        WireJsonContext.Default.Updates
      );
      WarnOf(updates.Failures);
      foreach (var package in Wire.OrEmpty(updates.Packages)) {
        foreach (var version in Wire.OrEmpty(package.Versions))
          if (PackageVersion.TryParse(version.Version, out var parsed) &&
              (!latest.TryGetValue(package.Id, out var known) || parsed.IsNewerThan(known))) {
            latest[package.Id] = parsed;
          }
      }
    }
  }

  private List<ConsolePackage> WithAdvisories(List<ConsolePackage> packages) {
    var known = Ask(ConsoleRequestNames.VULNERABILITIES, WireJsonContext.Default.Vulnerabilities);
    WarnOf(known.Failures);
    var advisories = Wire.OrEmpty(known.Packages).ToLookup(
      package => $"{package.Id}/{package.Version}",
      package => Wire.OrEmpty(package.Advisories),
      StringComparer.OrdinalIgnoreCase
    );

    return packages
      .Select(package => (package, found: advisories[$"{package.Id}/{package.Version}"].SelectMany(list => list)
        .Select(advisory => new ConsoleAdvisory(advisory.Severity, advisory.Url))
        .ToList()))
      .Where(pair => pair.found.Count > 0)
      .Select(pair => new ConsolePackage(pair.package.Id, pair.package.Version, pair.package.ProjectName) {
        LatestVersion = pair.package.LatestVersion,
        IsTransitive = pair.package.IsTransitive,
        Via = pair.package.Via,
        Advisories = pair.found
      })
      .ToList();
  }
}
