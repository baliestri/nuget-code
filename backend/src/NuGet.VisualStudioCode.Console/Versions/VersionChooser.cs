// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

namespace NuGet.VisualStudioCode.Console.Versions;

/// <summary>Chooses the version an update goes to.</summary>
internal static class VersionChooser {
  /// <summary>
  ///   The newest of the available versions that is newer than the installed one and within the bound.
  ///   Prereleases count only when asked. Null when there is none: the package is where it can be.
  /// </summary>
  public static PackageVersion? Choose(IEnumerable<string> available, PackageVersion installed, VersionBound bound,
    bool prerelease) {
    PackageVersion? chosen = null;
    foreach (var text in available) {
      if (!PackageVersion.TryParse(text, out var candidate) ||
          candidate.IsPrerelease && !prerelease ||
          !Within(candidate, installed, bound) ||
          !candidate.IsNewerThan(installed)) {
        continue;
      }

      if (chosen is null ||
          candidate.IsNewerThan(chosen)) {
        chosen = candidate;
      }
    }

    return chosen;
  }

  private static bool Within(PackageVersion candidate, PackageVersion installed, VersionBound bound)
    => bound switch {
      VersionBound.Minor => candidate.Major == installed.Major,
      VersionBound.Patch => candidate.Major == installed.Major && candidate.Minor == installed.Minor,
      var _ => true
    };
}
