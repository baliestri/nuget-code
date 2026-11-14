// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.Commands;
using NuGet.Common;
using NuGet.ProjectModel;
using NuGet.Protocol.Core.Types;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Projects;
using NuGet.VisualStudioCode.Protocol;

namespace NuGet.VisualStudioCode.Restore;

/// <summary>
///   Restores inside this process with NuGet's own restore command, from the restore graph the projects were
///   evaluated into. No <c>dotnet</c> process is started.
/// </summary>
internal sealed class EmbeddedRestoreEngine(NuGetLogAdapter logger) : IRestoreEngine {
  private readonly static StringComparer PathComparer =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparer.OrdinalIgnoreCase
      : StringComparer.Ordinal;

  public string Name => RestoreEngineNames.EMBEDDED;

  public async Task<IReadOnlyList<ProjectOperationResult>> RestoreAsync(RestoreTarget target, CancellationToken ct) {
    var restorable = target.Projects.Where(project => SpecOf(project) is not null).ToList();
    var summaries = restorable.Count == 0
      ? []
      : await RunAsync(restorable, target.Force, ct).ConfigureAwait(false);
    return target.Projects.Select(project => ResultOf(project, summaries)).ToList();
  }

  private async Task<IReadOnlyList<RestoreSummary>> RunAsync(List<EvaluatedProject> projects, bool force,
    CancellationToken ct) {
    try {
      using var cache = new SourceCacheContext();
      var arguments = new RestoreArgs {
        CacheContext = cache,
        Log = logger,
        AllowNoOp = !force,
        PreLoadedRequestProviders = [
          new DependencyGraphSpecRequestProvider(new RestoreCommandProvidersCache(), Merge(projects))
        ]
      };
      return await RestoreRunner.RunAsync(arguments, ct).ConfigureAwait(false);
    }
    catch (Exception exception) when (exception is not OperationCanceledException) {
      throw new RestoreEngineException(exception.Message, exception);
    }
  }

  // One graph with every project the targets know about, in which only the targets are marked for restore.
  private static DependencyGraphSpec Merge(List<EvaluatedProject> projects) {
    var merged = new DependencyGraphSpec();
    var known = new HashSet<string>(PathComparer);
    foreach (var spec in projects.SelectMany(project => project.Graph?.Projects ?? []))
      if (known.Add(spec.RestoreMetadata.ProjectUniqueName)) {
        merged.AddProject(spec.Clone());
      }

    foreach (var project in projects) merged.AddRestore(SpecOf(project)?.RestoreMetadata.ProjectUniqueName);

    return merged;
  }

  private static PackageSpec? SpecOf(EvaluatedProject project)
    => project.Graph?.Projects.FirstOrDefault(spec
      => PathComparer.Equals(spec.RestoreMetadata?.ProjectPath, project.Info.Path));

  private static ProjectOperationResult ResultOf(EvaluatedProject project, IReadOnlyList<RestoreSummary> summaries) {
    var path = project.Info.Path;
    if (SpecOf(project) is null) {
      return Failed(path, project.Info.Error ?? "The project could not be evaluated.");
    }

    var summary = summaries.FirstOrDefault(candidate => PathComparer.Equals(candidate.InputPath, path));
    if (summary is null) {
      return Failed(path, "The restore did not report a result for this project.");
    }

    var messages = summary.Errors
      .Select(message => new RestoreMessageInfo(LevelOf(message.Level), CodeOf(message.Code), message.Message))
      .ToList();
    var state = !summary.Success ? RestoreStates.FAILED
      : messages.Count > 0 ? RestoreStates.SUCCEEDED_WITH_WARNINGS
      : RestoreStates.SUCCEEDED;
    return new ProjectOperationResult(path, [], [], state, messages);
  }

  private static ProjectOperationResult Failed(string path, string message)
    => new(path, [], [], RestoreStates.FAILED, [new RestoreMessageInfo(LogLevels.ERROR, null, message)]);

  private static string LevelOf(LogLevel level)
    => level == LogLevel.Warning ? LogLevels.WARNING : LogLevels.ERROR;

  private static string? CodeOf(NuGetLogCode code)
    => code == NuGetLogCode.Undefined ? null : code.ToString();
}
