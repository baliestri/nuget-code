// Copyright (c) Bruno Sales <me@baliestri.dev>. Licensed under the zlib/libpng License.
// See the LICENSE file in the repository root for full license text.

using NuGet.ProjectModel;
using NuGet.VisualStudioCode.Logging;
using NuGet.VisualStudioCode.Rpc;
using NuGet.VisualStudioCode.Solutions;

namespace NuGet.VisualStudioCode.Projects;

internal sealed class ProjectEvaluator(RestoreGraphGenerator generator, BackendLog log) {
  private const int MAX_PARALLEL = 4;

  private readonly static StringComparison PathComparison =
    OperatingSystem.IsWindows() || OperatingSystem.IsMacOS()
      ? StringComparison.OrdinalIgnoreCase
      : StringComparison.Ordinal;

  public async Task<IReadOnlyList<EvaluatedProject>> EvaluateAsync(SolutionDescriptor solution, CancellationToken ct) {
    var models = await EvaluateAllAsync(solution, ct).ConfigureAwait(false);
    if (models.Count > 0 &&
        models.All(model => model.Info.Error is not null)) {
      throw new RpcException(RpcErrorCodes.EVALUATION_FAILED, "No project in the solution could be evaluated.",
        models[0].Info.Error);
    }

    return models;
  }

  public async Task<EvaluatedProject> EvaluateProjectAsync(string projectPath, string workingDirectory,
    CancellationToken ct) {
    var result = await generator.GenerateAsync(projectPath, workingDirectory, ct).ConfigureAwait(false);
    if (result.Graph is not null) {
      return FromGraph(result.Graph, projectPath);
    }

    log.Write(LogLevels.WARNING, LogContexts.BACKEND, $"Evaluation of '{projectPath}' failed: {result.Error}");
    return EvaluatedProjectBuilder.Failed(projectPath, result.Error ?? "Evaluation failed.");
  }

  private async Task<IReadOnlyList<EvaluatedProject>> EvaluateAllAsync(SolutionDescriptor solution,
    CancellationToken ct) {
    if (solution.Kind is SolutionKind.Sln or SolutionKind.Slnx) {
      var whole = await generator.GenerateAsync(solution.Path, solution.Directory, ct).ConfigureAwait(false);
      if (whole.Graph is not null) {
        return solution.ProjectPaths.Select(path => FromGraph(whole.Graph, path)).ToList();
      }

      log.Write(LogLevels.WARNING, LogContexts.BACKEND,
        "Solution-wide evaluation failed; evaluating project by project.");
    }

    using var gate = new SemaphoreSlim(MAX_PARALLEL);
    var tasks = new List<Task<EvaluatedProject>>();
    foreach (var path in solution.ProjectPaths) tasks.Add(EvaluateGatedAsync(gate, path, solution.Directory, ct));

    return await Task.WhenAll(tasks).ConfigureAwait(false);
  }

  private async Task<EvaluatedProject> EvaluateGatedAsync(SemaphoreSlim gate, string projectPath,
    string workingDirectory, CancellationToken ct) {
    await gate.WaitAsync(ct).ConfigureAwait(false);
    try {
      return await EvaluateProjectAsync(projectPath, workingDirectory, ct).ConfigureAwait(false);
    }
    finally {
      gate.Release();
    }
  }

  private static EvaluatedProject FromGraph(DependencyGraphSpec graph, string projectPath) {
    var spec = graph.Projects.FirstOrDefault(candidate
      => string.Equals(candidate.RestoreMetadata?.ProjectPath, projectPath, PathComparison)
    );
    return spec is null
      ? EvaluatedProjectBuilder.Failed(projectPath,
        "The project is not part of the restore graph. It may not use PackageReference.")
      : EvaluatedProjectBuilder.Build(spec, graph);
  }
}
