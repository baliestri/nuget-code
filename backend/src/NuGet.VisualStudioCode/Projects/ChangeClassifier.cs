// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Projects;

internal static class ChangeClassifier {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly static HashSet<string> SharedFiles = new(StringComparer.OrdinalIgnoreCase) {
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
    "global.json",
    "nuget.config"
  };

  public static ChangeImpact Classify(Session session, IReadOnlyList<string> changedPaths) {
    var solution = false;
    var projects = new HashSet<string>(PathComparer);
    var assets = new HashSet<string>(PathComparer);
    foreach (var path in changedPaths) {
      if (SharedFiles.Contains(Path.GetFileName(path)) ||
          PathComparer.Equals(path, session.Solution.Path)) {
        solution = true;
        continue;
      }

      var project = session.Projects.FirstOrDefault(model => PathComparer.Equals(model.Info.Path, path));
      if (project is not null) {
        projects.Add(project.Info.Path);
        continue;
      }

      var owner = session.Projects.FirstOrDefault(model
        => model.AssetsPath is not null && PathComparer.Equals(model.AssetsPath, path));
      if (owner is not null) {
        assets.Add(owner.Info.Path);
      }
    }

    return new ChangeImpact(solution, projects, assets);
  }
}
