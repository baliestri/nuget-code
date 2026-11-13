// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Frameworks;
using NuGet.LibraryModel;
using NuGet.ProjectModel;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

internal static class EvaluatedProjectBuilder {
  private const string ASSETS_FILE = "project.assets.json";

  public static EvaluatedProject Build(PackageSpec spec) {
    var metadata = spec.RestoreMetadata;
    var frameworks = SortedFrameworks(spec);
    var packages = spec.TargetFrameworks
      .SelectMany(framework
        => framework.Dependencies.Select(dependency => (Framework: Alias(framework), Dependency: dependency)))
      .GroupBy(entry => entry.Dependency.Name, StringComparer.OrdinalIgnoreCase)
      .Select(group => new DeclaredPackage(
        group.First().Dependency.Name,
        Requested(group.First().Dependency),
        group.Select(entry => entry.Framework)
          .Distinct(StringComparer.Ordinal)
          .OrderBy(frameworks.IndexOf)
          .ToList(),
        group.All(entry => entry.Dependency.AutoReferenced),
        group.Any(entry => entry.Dependency.VersionOverride is not null)
      ))
      .OrderBy(package => package.Id, StringComparer.OrdinalIgnoreCase)
      .ToList();
    var info = new ProjectInfo(spec.Name, metadata.ProjectPath, frameworks, metadata.CentralPackageVersionsEnabled,
      null);
    return new EvaluatedProject(info, packages, Path.Combine(metadata.OutputPath, ASSETS_FILE));
  }

  public static EvaluatedProject Failed(string projectPath, string error)
    => new(new ProjectInfo(Path.GetFileNameWithoutExtension(projectPath), projectPath, [], false, error), [], null);

  // The graph lists target frameworks alphabetically and does not keep the order the project declares.
  // Sorting by framework and version (net8.0 before net10.0) gives a stable order without another MSBuild call.
  private static List<string> SortedFrameworks(PackageSpec spec)
    => spec.TargetFrameworks
      .OrderBy(framework => framework.FrameworkName, NuGetFrameworkSorter.Instance)
      .Select(Alias)
      .ToList();

  private static string Alias(TargetFrameworkInformation framework)
    => string.IsNullOrEmpty(framework.TargetAlias)
      ? framework.FrameworkName.GetShortFolderName()
      : framework.TargetAlias;

  // The graph stores the normalized range ("[1.0.0, )"); the short form is what the project file says ("1.0.0").
  private static string? Requested(LibraryDependency dependency)
    => dependency.LibraryRange.VersionRange?.ToShortString();
}
