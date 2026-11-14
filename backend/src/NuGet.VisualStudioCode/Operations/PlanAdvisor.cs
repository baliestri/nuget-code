// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Frameworks;
using NuGet.VisualStudioCode.Feeds;
using NuGet.VisualStudioCode.Projects;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Adds the warnings that need the feed: whether the package version being installed lists a framework the
///   project can use. It only warns. A feed that does not answer means no warning, never a refusal.
/// </summary>
internal sealed class PlanAdvisor(PackageDetailsService details) {
  public async Task<IReadOnlyList<PlanWarning>> FrameworkWarningsAsync(IReadOnlyList<PackageChange> changes,
    IReadOnlyList<EvaluatedProject> projects, CancellationToken ct) {
    var warnings = new List<PlanWarning>();
    foreach (var change in changes) {
      if (change.Version is null ||
          string.Equals(change.Kind, PackageChangeKinds.REMOVE, StringComparison.Ordinal)) {
        continue;
      }

      var supported = await details.FrameworksAsync(change.Id, change.Version, ct).ConfigureAwait(false);
      if (supported is null ||
          supported.Count == 0) {
        continue;
      }

      foreach (var project in projects.Where(candidate
                 => change.Projects.Contains(candidate.Info.Path, StringComparer.OrdinalIgnoreCase))) {
        var unsupported = project.Info.Frameworks.Where(framework => !IsSupported(framework, supported)).ToList();
        if (unsupported.Count > 0) {
          warnings.Add(new PlanWarning(PlanWarningKinds.FRAMEWORK_MISMATCH, change.Id, null, [project.Info.Path],
            [], string.Join(", ", unsupported)));
        }
      }
    }

    return warnings;
  }

  private static bool IsSupported(string projectFramework, IReadOnlyList<string> packageFrameworks) {
    var project = NuGetFramework.Parse(projectFramework);
    if (project.IsUnsupported) {
      return true;
    }

    return packageFrameworks
      .Select(NuGetFramework.Parse)
      .Any(package => package.IsAny || DefaultCompatibilityProvider.Instance.IsCompatible(project, package));
  }
}
