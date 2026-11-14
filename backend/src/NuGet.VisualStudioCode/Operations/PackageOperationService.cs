// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;
using NuGet.VisualStudioCode.Restore;
using NuGet.VisualStudioCode.Sessions;

namespace NuGet.VisualStudioCode.Operations;

/// <summary>
///   Carries a package change through: plan, write, evaluate again, restore. Nothing here refuses a change
///   because of what the restore might say: the files are edited first and the restore reports afterwards.
/// </summary>
internal sealed class PackageOperationService(
  SessionManager sessions,
  SessionRefresher refresher,
  RestoreService restore,
  BackendLog log,
  Func<OperationProgressParams, Task> progress
) {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  private readonly static string[] SharedWarnings = [
    PlanWarningKinds.CENTRAL_SHARED, PlanWarningKinds.IMPORTED_SHARED, PlanWarningKinds.PROPERTY_SHARED
  ];

  public async Task<OperationResult> RunAsync(IReadOnlyList<PackageChange> changes, CancellationToken ct) {
    await StepAsync(OperationSteps.PLANNING).ConfigureAwait(false);
    var session = sessions.Require();
    var plan = new PackageChangePlanner(session.Projects, new ProjectFileSet()).Plan(changes);
    var affected = Affected(changes, plan);

    await StepAsync(OperationSteps.EDITING).ConfigureAwait(false);
    var edits = Apply(session, changes, plan);
    var written = edits.Where(edit => edit.Applied).Select(edit => edit.File).ToList();
    var failures = edits.Where(edit => !edit.Applied).ToList();
    log.Write(LogLevels.INFO, LogContexts.BACKEND,
      $"Package change: {written.Count} file(s) written, {failures.Count} failed.");

    OperationResult? restored = null;
    if (written.Count > 0) {
      await StepAsync(OperationSteps.EVALUATING).ConfigureAwait(false);
      await refresher.RefreshNowAsync(written, ct).ConfigureAwait(false);

      await StepAsync(OperationSteps.RESTORING).ConfigureAwait(false);
      restored = await RestoreAsync(affected.Where(project => !DependsOnAny(project, failures)).ToList(), ct)
        .ConfigureAwait(false);
    }

    await StepAsync(OperationSteps.DONE).ConfigureAwait(false);
    return new OperationResult(restored?.Engine, restored?.FellBack ?? false,
      affected.Select(project => ResultOf(project, written, failures, restored)).ToList());
  }

  private Task StepAsync(string step)
    => progress(new OperationProgressParams(step, null));

  // A file that changed between planning and writing is planned again, once, against what is on disk now.
  private static List<FileEditResult> Apply(Session session, IReadOnlyList<PackageChange> changes, ChangePlan plan) {
    var results = FileEditApplier.Apply(plan.Edits).ToList();
    var stale = results.Where(result => result.Stale).Select(result => result.File).ToHashSet(PathComparer);
    if (stale.Count == 0) {
      return results;
    }

    var again = new PackageChangePlanner(session.Projects, new ProjectFileSet()).Plan(changes);
    var retried = FileEditApplier.Apply(again.Edits.Where(edit => stale.Contains(edit.File)).ToList());
    return results.Where(result => !stale.Contains(result.File)).Concat(retried).ToList();
  }

  // The projects of the change plus the ones that share a file the change edits.
  private static List<string> Affected(IReadOnlyList<PackageChange> changes, ChangePlan plan)
    => changes
      .SelectMany(change => change.Projects)
      .Concat(plan.Warnings
        .Where(warning => SharedWarnings.Contains(warning.Kind, StringComparer.Ordinal))
        .SelectMany(warning => warning.Projects))
      .Distinct(PathComparer)
      .ToList();

  private async Task<OperationResult?> RestoreAsync(List<string> paths, CancellationToken ct) {
    var session = sessions.Require();
    var projects = session.Projects.Where(project => paths.Contains(project.Info.Path, PathComparer)).ToList();
    if (projects.Count == 0) {
      return null;
    }

    var target = new RestoreTarget(session.Solution, projects, projects.Count == session.Projects.Count, false);
    var result = await restore.RestoreAsync(target, null, ct).ConfigureAwait(false);
    refresher.Report(projects.Select(project => project.AssetsPath).OfType<string>().ToList());
    return result;
  }

  private static ProjectOperationResult ResultOf(string project, List<string> written, List<FileEditResult> failures,
    OperationResult? restored) {
    var outcome = restored?.Projects.FirstOrDefault(result => PathComparer.Equals(result.Project, project));
    return new ProjectOperationResult(
      project,
      written.Where(file => DependsOn(project, file)).ToList(),
      failures.Where(failure => DependsOn(project, failure.File))
        .Select(failure => $"{failure.File}: {failure.Error}")
        .ToList(),
      outcome?.Restore ?? RestoreStates.NOT_RUN,
      outcome?.Messages ?? []
    );
  }

  private static bool DependsOnAny(string project, List<FileEditResult> failures)
    => failures.Exists(failure => DependsOn(project, failure.File));

  // A project depends on its own file and on the shared files in the directories above it.
  private static bool DependsOn(string project, string file) {
    if (PathComparer.Equals(project, file)) {
      return true;
    }

    var extension = Path.GetExtension(file);
    if (extension.EndsWith("proj", StringComparison.OrdinalIgnoreCase)) {
      return false;
    }

    var directory = Path.GetDirectoryName(file) ?? string.Empty;
    var comparison = ReferenceEquals(PathComparer, StringComparer.Ordinal)
      ? StringComparison.Ordinal
      : StringComparison.OrdinalIgnoreCase;
    return project.StartsWith(directory + Path.DirectorySeparatorChar, comparison);
  }
}
