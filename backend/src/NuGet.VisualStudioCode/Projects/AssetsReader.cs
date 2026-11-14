// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Projects;

internal static class AssetsReader {
  private const string PACKAGE = "package";

  /// <summary>
  ///   Reads <c>obj/project.assets.json</c>. <paramref name="directIds" /> are the packages the project
  ///   references itself; every other resolved package is transitive. Returns <c>null</c> when the project
  ///   was never restored or the file cannot be read.
  /// </summary>
  public static ResolvedAssets? Read(string? assetsPath, IReadOnlyCollection<string> directIds) {
    if (assetsPath is null ||
        !File.Exists(assetsPath)) {
      return null;
    }

    LockFile lockFile;
    try {
      lockFile = new LockFileFormat().Read(assetsPath);
    }
    catch (IOException) {
      return null;
    }
    catch (FileFormatException) {
      return null;
    }

    var resolved = lockFile.Libraries
      .Where(library => string.Equals(library.Type, PACKAGE, StringComparison.OrdinalIgnoreCase))
      .GroupBy(library => library.Name, StringComparer.OrdinalIgnoreCase)
      .ToDictionary(
        group => group.Key,
        group => group.Max(library => library.Version)!.ToNormalizedString(),
        StringComparer.OrdinalIgnoreCase
      );
    return new ResolvedAssets(resolved, Transitive(lockFile, resolved, directIds));
  }

  private static List<TransitivePackage> Transitive(LockFile lockFile, Dictionary<string, string> resolved,
    IReadOnlyCollection<string> directIds) {
    var direct = new HashSet<string>(directIds, StringComparer.OrdinalIgnoreCase);
    var dependencies = Dependencies(lockFile);
    var frameworks = Frameworks(lockFile);

    // From each package the project references, everything that can be reached is there because of it.
    var via = new Dictionary<string, SortedSet<string>>(StringComparer.OrdinalIgnoreCase);
    foreach (var root in direct.Where(resolved.ContainsKey))
      foreach (var reached in Reachable(root, dependencies)) {
        if (!via.TryGetValue(reached, out var roots)) {
          via[reached] = roots = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        roots.Add(root);
      }

    return resolved
      .Where(package => !direct.Contains(package.Key))
      .OrderBy(package => package.Key, StringComparer.OrdinalIgnoreCase)
      .Select(package => new TransitivePackage(
        package.Key,
        package.Value,
        frameworks.TryGetValue(package.Key, out var found) ? found : [],
        via.TryGetValue(package.Key, out var roots) ? roots.ToList() : []
      ))
      .ToList();
  }

  /// <summary>What each library depends on, in any target framework.</summary>
  private static Dictionary<string, HashSet<string>> Dependencies(LockFile lockFile) {
    var edges = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
    foreach (var library in lockFile.Targets.SelectMany(target => target.Libraries)) {
      if (library.Name is null) {
        continue;
      }

      if (!edges.TryGetValue(library.Name, out var targets)) {
        edges[library.Name] = targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      }

      foreach (var dependency in library.Dependencies) targets.Add(dependency.Id);
    }

    return edges;
  }

  /// <summary>The target frameworks each package appears in, in the order of the file.</summary>
  private static Dictionary<string, List<string>> Frameworks(LockFile lockFile) {
    var frameworks = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
    foreach (var target in lockFile.Targets) {
      var name = target.TargetFramework.GetShortFolderName();
      foreach (var library in target.Libraries) {
        if (library.Name is null ||
            !string.Equals(library.Type, PACKAGE, StringComparison.OrdinalIgnoreCase)) {
          continue;
        }

        if (!frameworks.TryGetValue(library.Name, out var names)) {
          frameworks[library.Name] = names = [];
        }

        // A target is listed once more for each runtime identifier.
        if (!names.Contains(name, StringComparer.OrdinalIgnoreCase)) {
          names.Add(name);
        }
      }
    }

    return frameworks;
  }

  private static IEnumerable<string> Reachable(string root, Dictionary<string, HashSet<string>> dependencies) {
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root };
    var pending = new Queue<string>();
    pending.Enqueue(root);
    while (pending.Count > 0) {
      if (!dependencies.TryGetValue(pending.Dequeue(), out var next)) {
        continue;
      }

      foreach (var dependency in next.Where(seen.Add)) {
        pending.Enqueue(dependency);
        yield return dependency;
      }
    }
  }
}
